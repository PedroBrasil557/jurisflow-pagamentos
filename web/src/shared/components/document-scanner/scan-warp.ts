import type { Corner, CornerPoints } from './scanner-engine'

// Warp de perspectiva (recorte + deskew) por WebGL — substitui o
// cv.getPerspectiveTransform + cv.warpPerspective do OpenCV/jscanify. Recebe a
// imagem-fonte e os 4 cantos do documento (em pixels da fonte) e devolve um canvas
// de saida outW x outH com o documento "achatado". O custo e KB (shader) em vez dos
// ~8.6 MB do opencv.js — a IA (DocAligner) ja faz a deteccao dos cantos.

// Resolve a homografia 3x3 que mapeia os pontos `from` -> `to` (4 correspondencias).
// Monta o sistema linear 8x8 e resolve por eliminacao de Gauss. Matriz devolvida em
// ordem COLUNA-major (pronta para uniformMatrix3fv). Mapeia (u,v,1) -> (x*w,y*w,w).
function solveHomography(from: Corner[], to: Corner[]): Float32Array | null {
  // 8 incognitas: a,b,c,d,e,f,g,h (o i=1 fica fixo).
  const a: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = from[i]
    const { x, y } = to[i]
    a.push([u, v, 1, 0, 0, 0, -u * x, -v * x])
    b.push(x)
    a.push([0, 0, 0, u, v, 1, -u * y, -v * y])
    b.push(y)
  }

  // Eliminacao de Gauss com pivotamento parcial.
  for (let col = 0; col < 8; col++) {
    let pivot = col
    for (let row = col + 1; row < 8; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) {
        pivot = row
      }
    }
    if (Math.abs(a[pivot][col]) < 1e-8) {
      return null // degenerado (cantos colineares/coincidentes)
    }
    if (pivot !== col) {
      ;[a[col], a[pivot]] = [a[pivot], a[col]]
      ;[b[col], b[pivot]] = [b[pivot], b[col]]
    }
    const inv = 1 / a[col][col]
    for (let k = col; k < 8; k++) {
      a[col][k] *= inv
    }
    b[col] *= inv
    for (let row = 0; row < 8; row++) {
      if (row === col) {
        continue
      }
      const factor = a[row][col]
      if (factor === 0) {
        continue
      }
      for (let k = col; k < 8; k++) {
        a[row][k] -= factor * a[col][k]
      }
      b[row] -= factor * b[col]
    }
  }

  const [c0, c1, c2, c3, c4, c5, c6, c7] = b
  // Coluna-major: [m00,m10,m20, m01,m11,m21, m02,m12,m22]
  // linhas = [[c0,c1,c2],[c3,c4,c5],[c6,c7,1]]
  return new Float32Array([c0, c3, c6, c1, c4, c7, c2, c5, 1])
}

const VERTEX_SRC = `
attribute vec2 aClip;
attribute vec2 aOutPx;
varying vec2 vOutPx;
void main() {
  vOutPx = aOutPx;
  gl_Position = vec4(aClip, 0.0, 1.0);
}`

const FRAGMENT_SRC = `
precision highp float;
uniform mat3 uMatrix;   // pixel de saida -> pixel da fonte
uniform vec2 uSrcSize;  // largura,altura da fonte em pixels
uniform sampler2D uSource;
varying vec2 vOutPx;
void main() {
  vec3 p = uMatrix * vec3(vOutPx, 1.0);
  vec2 srcPx = p.xy / p.z;
  vec2 uv = srcPx / uSrcSize;
  gl_FragColor = texture2D(uSource, uv);
}`

type GlContext = {
  canvas: HTMLCanvasElement
  gl: WebGLRenderingContext
  program: WebGLProgram
  loc: {
    aClip: number
    aOutPx: number
    uMatrix: WebGLUniformLocation
    uSrcSize: WebGLUniformLocation
    uSource: WebGLUniformLocation
  }
  clipBuffer: WebGLBuffer
  outPxBuffer: WebGLBuffer
  texture: WebGLTexture
}

// Contexto WebGL singleton: contextos GL sao limitados (~16 por aba); reusamos um
// so, redimensionando o canvas por chamada. null = WebGL indisponivel (fallback).
let ctx: GlContext | null | undefined

function compile(
  gl: WebGLRenderingContext,
  type: number,
  src: string,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) {
    return null
  }
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function initGl(): GlContext | null {
  const canvas = document.createElement('canvas')
  const gl =
    canvas.getContext('webgl', { premultipliedAlpha: false }) ??
    (canvas.getContext('experimental-webgl', {
      premultipliedAlpha: false,
    }) as WebGLRenderingContext | null)
  if (!gl) {
    return null
  }

  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SRC)
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC)
  if (!vs || !fs) {
    return null
  }
  const program = gl.createProgram()
  if (!program) {
    return null
  }
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return null
  }

  const aClip = gl.getAttribLocation(program, 'aClip')
  const aOutPx = gl.getAttribLocation(program, 'aOutPx')
  const uMatrix = gl.getUniformLocation(program, 'uMatrix')
  const uSrcSize = gl.getUniformLocation(program, 'uSrcSize')
  const uSource = gl.getUniformLocation(program, 'uSource')
  const clipBuffer = gl.createBuffer()
  const outPxBuffer = gl.createBuffer()
  const texture = gl.createTexture()
  if (
    !uMatrix ||
    !uSrcSize ||
    !uSource ||
    !clipBuffer ||
    !outPxBuffer ||
    !texture
  ) {
    return null
  }

  // Dois triangulos cobrindo o clip-space. clip(-1,+1) = topo-esquerdo do canvas.
  const clip = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
  gl.bindBuffer(gl.ARRAY_BUFFER, clipBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, clip, gl.STATIC_DRAW)

  return {
    canvas,
    gl,
    program,
    loc: { aClip, aOutPx, uMatrix, uSrcSize, uSource },
    clipBuffer,
    outPxBuffer,
    texture,
  }
}

function getCtx(): GlContext | null {
  if (ctx === undefined) {
    try {
      ctx = initGl()
    } catch {
      ctx = null
    }
  }
  return ctx
}

// Recorta a fonte pela perspectiva dos 4 cantos e devolve um canvas outW x outH ja
// "achatado". Se o WebGL nao estiver disponivel ou algo falhar, devolve `source`
// (nao recortado) — mesma degradacao graciosa do fluxo antigo (`extracted ?? source`).
export function warpPerspectiveToCanvas(
  source: HTMLCanvasElement,
  corners: CornerPoints,
  outW: number,
  outH: number,
): HTMLCanvasElement {
  const width = Math.max(1, Math.round(outW))
  const height = Math.max(1, Math.round(outH))
  const glCtx = getCtx()
  if (!glCtx) {
    return source
  }

  // Homografia: pixel de SAIDA (retangulo outW x outH) -> pixel da FONTE (quad).
  // Mesma ordem nos dois lados: TL, TR, BR, BL.
  const outRect: Corner[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ]
  const srcQuad: Corner[] = [
    corners.topLeftCorner,
    corners.topRightCorner,
    corners.bottomRightCorner,
    corners.bottomLeftCorner,
  ]
  const matrix = solveHomography(outRect, srcQuad)
  if (!matrix) {
    return source
  }

  const { gl, program, loc } = glCtx
  glCtx.canvas.width = width
  glCtx.canvas.height = height

  try {
    // aOutPx casa cada vertice do clip com o pixel de saida correspondente. clip
    // y=-1 (baixo) -> y de saida = height; clip y=+1 (topo) -> y de saida = 0.
    const outPx = new Float32Array([
      0,
      height, // (-1,-1)
      width,
      height, // (1,-1)
      0,
      0, // (-1,1)
      width,
      0, // (1,1)
    ])
    gl.bindBuffer(gl.ARRAY_BUFFER, glCtx.outPxBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, outPx, gl.STATIC_DRAW)

    // Textura da fonte: sem flip (amostramos em coords de imagem top-down),
    // CLAMP_TO_EDGE (fora do quad copia a borda) e LINEAR (bilinear).
    gl.bindTexture(gl.TEXTURE_2D, glCtx.texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)

    gl.viewport(0, 0, width, height)
    // Alias sem prefixo `use`: gl.useProgram NAO e um hook do React, mas o lint
    // rules-of-hooks o confunde pelo nome. O bind evita o falso-positivo.
    const selectProgram = gl.useProgram.bind(gl)
    selectProgram(program)

    gl.bindBuffer(gl.ARRAY_BUFFER, glCtx.clipBuffer)
    gl.enableVertexAttribArray(loc.aClip)
    gl.vertexAttribPointer(loc.aClip, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, glCtx.outPxBuffer)
    gl.enableVertexAttribArray(loc.aOutPx)
    gl.vertexAttribPointer(loc.aOutPx, 2, gl.FLOAT, false, 0, 0)

    gl.uniformMatrix3fv(loc.uMatrix, false, matrix)
    gl.uniform2f(loc.uSrcSize, source.width, source.height)
    gl.uniform1i(loc.uSource, 0)

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    // Le o resultado para um canvas 2D (o pipeline seguinte usa getImageData).
    const out = document.createElement('canvas')
    out.width = width
    out.height = height
    const outCtx = out.getContext('2d')
    if (!outCtx) {
      return source
    }
    outCtx.drawImage(glCtx.canvas, 0, 0)
    return out
  } catch {
    return source
  }
}
