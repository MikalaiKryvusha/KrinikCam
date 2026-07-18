/**
 * GlQuadRenderer — рисование текстурированного полноэкранного квада для GL-композитора (Idea 25).
 *
 * Две шейдер-программы (как в grafika): TEXTURE_2D (картинки-битмапы) и TEXTURE_EXT/OES (кадры камеры из
 * SurfaceTexture). Один full-screen квад (triangle strip) в clip-space. Текстурные координаты приводятся
 * матрицей `uTexMatrix`: для 2D — V-flip (битмап сверху-вниз → upright), для OES — матрица SurfaceTexture.
 * Альфа-блендинг для прозрачных оверлеев.
 *
 * Создаётся и используется СТРОГО на GL-потоке (после makeCurrent).
 */

package com.kriniks.kcam.feature.streaming.gl

import android.graphics.Bitmap
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLUtils
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

class GlQuadRenderer {

    // Полноэкранный квад: позиция (x,y) в clip-space + texcoord (u,v). Triangle strip BL,BR,TL,TR.
    private val vertices = floatArrayOf(
        // x,    y,    u,   v
        -1f, -1f, 0f, 0f,
         1f, -1f, 1f, 0f,
        -1f,  1f, 0f, 1f,
         1f,  1f, 1f, 1f,
    )
    private val vbo: FloatBuffer = ByteBuffer.allocateDirect(vertices.size * 4)
        .order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(vertices); position(0) }

    private val prog2d = buildProgram(VERTEX, FRAG_2D)
    private val progOes = buildProgram(VERTEX, FRAG_OES)

    // V-flip для 2D-битмапов (column-major): y' = 1 - y.
    private val flipY = floatArrayOf(1f, 0f, 0f, 0f, 0f, -1f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 1f, 0f, 1f)
    private val identity = floatArrayOf(1f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 1f)

    /** Залить битмап в новую GL_TEXTURE_2D, вернуть texId. */
    fun uploadBitmap(bmp: Bitmap): Int {
        val ids = IntArray(1)
        GLES20.glGenTextures(1, ids, 0)
        val id = ids[0]
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, id)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bmp, 0)
        return id
    }

    /** Создать внешнюю OES-текстуру (для кадров камеры через SurfaceTexture), вернуть texId. */
    fun createOesTexture(): Int {
        val ids = IntArray(1)
        GLES20.glGenTextures(1, ids, 0)
        val id = ids[0]
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, id)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        return id
    }

    fun deleteTexture(id: Int) { if (id != 0) GLES20.glDeleteTextures(1, intArrayOf(id), 0) }

    /**
     * Bug 29.2 (двухпроходный рендер) — создать offscreen framebuffer (FBO) с цветовой текстурой
     * [w]×[h]. Проход 1 рисует сцену (камера 16:9 + оверлеи) СЮДА (логический холст 16:9, аспект-
     * корректно), проход 2 блитит эту текстуру в выходной кадр с поворотом холста. Возвращает
     * (fboId, texId). Удаление — [deleteFramebuffer].
     */
    fun createFramebuffer(w: Int, h: Int): Pair<Int, Int> {
        val tex = IntArray(1); GLES20.glGenTextures(1, tex, 0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, tex[0])
        GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, w, h, 0, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        val fbo = IntArray(1); GLES20.glGenFramebuffers(1, fbo, 0)
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fbo[0])
        GLES20.glFramebufferTexture2D(GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0, GLES20.GL_TEXTURE_2D, tex[0], 0)
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
        return fbo[0] to tex[0]
    }

    fun deleteFramebuffer(fbo: Int) { if (fbo != 0) GLES20.glDeleteFramebuffers(1, intArrayOf(fbo), 0) }

    /**
     * Создать отдельную цветовую 2D-текстуру [w]×[h] (без FBO) — для пинг-понг снапшота кадра камеры
     * (CompositorVideoSource: держим два последних кадра, показываем предпоследний, чтобы не выводить
     * битый/чёрный последний кадр и не мигать в чёрное при реконнекте). Рендер в неё — привязав её к
     * общему FBO через [setFramebufferColor].
     */
    fun createColorTexture(w: Int, h: Int): Int {
        val tex = IntArray(1); GLES20.glGenTextures(1, tex, 0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, tex[0])
        GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, w, h, 0, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        return tex[0]
    }

    /** Привязать текстуру [tex] цветовым выходом FBO [fbo] (для пинг-понг рендера в разные текстуры). */
    fun setFramebufferColor(fbo: Int, tex: Int) {
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fbo)
        GLES20.glFramebufferTexture2D(GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0, GLES20.GL_TEXTURE_2D, tex, 0)
    }

    /** Bug 29.2 — направить рендер в FBO (проход 1) или в экран/энкодер (fbo=0, проход 2). */
    fun bindFramebuffer(fbo: Int) { GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fbo) }

    /**
     * Нарисовать текстуру квадом. [oes]=true → OES-программа (камера) с [texMatrix] от SurfaceTexture;
     * иначе 2D с V-flip. [posMatrix] — модельная матрица позиции квада в clip-space (масштаб/сдвиг для
     * PiP; null = во весь кадр). [alpha] — прозрачность слоя.
     */
    fun draw(
        texId: Int,
        oes: Boolean,
        texMatrix: FloatArray? = null,
        posMatrix: FloatArray? = null,
        alpha: Float = 1f,
    ) {
        val prog = if (oes) progOes else prog2d
        GLES20.glUseProgram(prog)
        val target = if (oes) GLES11Ext.GL_TEXTURE_EXTERNAL_OES else GLES20.GL_TEXTURE_2D

        val aPos = GLES20.glGetAttribLocation(prog, "aPosition")
        val aTex = GLES20.glGetAttribLocation(prog, "aTexCoord")
        val uTexM = GLES20.glGetUniformLocation(prog, "uTexMatrix")
        val uPosM = GLES20.glGetUniformLocation(prog, "uPosMatrix")
        val uAlpha = GLES20.glGetUniformLocation(prog, "uAlpha")
        val uTexture = GLES20.glGetUniformLocation(prog, "uTexture")

        vbo.position(0)
        GLES20.glEnableVertexAttribArray(aPos)
        GLES20.glVertexAttribPointer(aPos, 2, GLES20.GL_FLOAT, false, 16, vbo)
        vbo.position(2)
        GLES20.glEnableVertexAttribArray(aTex)
        GLES20.glVertexAttribPointer(aTex, 2, GLES20.GL_FLOAT, false, 16, vbo)

        GLES20.glUniformMatrix4fv(uTexM, 1, false, texMatrix ?: if (oes) identity else flipY, 0)
        GLES20.glUniformMatrix4fv(uPosM, 1, false, posMatrix ?: identity, 0)
        GLES20.glUniform1f(uAlpha, alpha)

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(target, texId)
        GLES20.glUniform1i(uTexture, 0)

        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glDisable(GLES20.GL_BLEND)

        GLES20.glDisableVertexAttribArray(aPos)
        GLES20.glDisableVertexAttribArray(aTex)
        GLES20.glBindTexture(target, 0)
    }

    private fun buildProgram(vsrc: String, fsrc: String): Int {
        val vs = compile(GLES20.GL_VERTEX_SHADER, vsrc)
        val fs = compile(GLES20.GL_FRAGMENT_SHADER, fsrc)
        val p = GLES20.glCreateProgram()
        GLES20.glAttachShader(p, vs)
        GLES20.glAttachShader(p, fs)
        GLES20.glLinkProgram(p)
        val status = IntArray(1)
        GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, status, 0)
        check(status[0] == GLES20.GL_TRUE) { "link failed: ${GLES20.glGetProgramInfoLog(p)}" }
        GLES20.glDeleteShader(vs); GLES20.glDeleteShader(fs)
        return p
    }

    private fun compile(type: Int, src: String): Int {
        val s = GLES20.glCreateShader(type)
        GLES20.glShaderSource(s, src)
        GLES20.glCompileShader(s)
        val status = IntArray(1)
        GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, status, 0)
        check(status[0] == GLES20.GL_TRUE) { "compile failed: ${GLES20.glGetShaderInfoLog(s)}" }
        return s
    }

    private companion object {
        const val VERTEX = """
            uniform mat4 uTexMatrix;
            uniform mat4 uPosMatrix;
            attribute vec4 aPosition;
            attribute vec4 aTexCoord;
            varying vec2 vTexCoord;
            void main() {
                gl_Position = uPosMatrix * aPosition;
                vTexCoord = (uTexMatrix * aTexCoord).xy;
            }
        """
        const val FRAG_2D = """
            precision mediump float;
            uniform sampler2D uTexture;
            uniform float uAlpha;
            varying vec2 vTexCoord;
            void main() {
                vec4 c = texture2D(uTexture, vTexCoord);
                gl_FragColor = vec4(c.rgb, c.a * uAlpha);
            }
        """
        const val FRAG_OES = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;
            uniform samplerExternalOES uTexture;
            uniform float uAlpha;
            varying vec2 vTexCoord;
            void main() {
                vec4 c = texture2D(uTexture, vTexCoord);
                gl_FragColor = vec4(c.rgb, c.a * uAlpha);
            }
        """
    }
}
