const EarthTone = new Float32Array([0.72, 0.52, 0.28, 1])
const HEIGHT_SCALE = 1.0
const LIGHT_DIR = normalize([0.4, 1.0, 0.3])
const GRID_SIZE = 100
const FAULTS = 200
const WORLD_UP = [0, 1, 0]
const MOVE_SPEED = 0.08
const TURN_SPEED = 1.2
const MAX_PITCH = Math.PI / 2 - 0.05
const CAMERA_HEIGHT = 0.08

window.keysBeingPressed = {}
window.eye = [0, CAMERA_HEIGHT, 0.5]
window.forward = normalize([0, -0.1, -1])
window.lastTime = null
window.heights = null
window.gridN = 0
window.gridStep = 1

async function setup()
{
    window.gl = document.querySelector('canvas').getContext('webgl2')
    const [vs, fs] = await Promise.all([
        loadText('glsl/vertex_shader.glsl'),
        loadText('glsl/fragment_shader.glsl'),
    ])
    window.program = compile(vs, fs)
    gl.useProgram(program)
    gl.enable(gl.DEPTH_TEST)
    window.geom = null

    window.addEventListener('keydown', event => {
        keysBeingPressed[event.key] = true
        if (event.key.startsWith('Arrow')) event.preventDefault()
    })
    window.addEventListener('keyup', event => {
        keysBeingPressed[event.key] = false
    })
    window.addEventListener('resize', fillScreen)

    fillScreen()
    window.geom = setupGeomery(generateTerrain(GRID_SIZE, FAULTS))
    window.eye[1] = terrainHeightAt(window.eye[0], window.eye[2]) + CAMERA_HEIGHT
    tick(0)
}

/**
 * Compiles two shaders, links them together, looks up their uniform locations,
 * and returns the result. Reports any shader errors to the console.
 *
 * @param {string} vs_source - the source code of the vertex shader
 * @param {string} fs_source - the source code of the fragment shader
 * @return {WebGLProgram} the compiled and linked program
 */
function compile(vs_source, fs_source)
{
    const vs = gl.createShader(gl.VERTEX_SHADER)
    gl.shaderSource(vs, vs_source)
    gl.compileShader(vs)
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(vs))
        throw Error("Vertex shader compilation failed")
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER)
    gl.shaderSource(fs, fs_source)
    gl.compileShader(fs)
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(fs))
        throw Error("Fragment shader compilation failed")
    }

    const program = gl.createProgram()
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(program))
        throw Error("Linking failed")
    }

    const uniforms = {}
    for(let i=0; i<gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i+=1)
    {
        let info = gl.getActiveUniform(program, i)
        uniforms[info.name] = gl.getUniformLocation(program, info.name)
    }
    program.uniforms = uniforms

    return program
}

function supplyDataBuffer(data, loc, mode)
{
    if (mode === undefined) mode = gl.STATIC_DRAW

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    const f32 = new Float32Array(data.flat())
    gl.bufferData(gl.ARRAY_BUFFER, f32, mode)

    gl.vertexAttribPointer(loc, data[0].length, gl.FLOAT, false, 0, 0)
    gl.enableVertexAttribArray(loc)

    return buf
}

function setupGeomery(geom)
{
    const triangleArray = gl.createVertexArray()
    gl.bindVertexArray(triangleArray)

    for(let i=0; i<geom.attributes.length; i+=1)
    {
        supplyDataBuffer(geom.attributes[i], i)
    }

    const indices = new Uint16Array(geom.triangles.flat())
    const indexBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)

    return {
        mode: gl.TRIANGLES,
        count: indices.length,
        type: gl.UNSIGNED_SHORT,
        vao: triangleArray
    }
}

function fillScreen()
{
    const canvas = document.querySelector('canvas')
    document.body.style.margin = '0'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.width = canvas.clientWidth
    canvas.height = canvas.clientHeight
    canvas.style.width = ''
    canvas.style.height = ''
    gl.viewport(0, 0, canvas.width, canvas.height)
    window.p = m4perspNegZ(0.05, 20, 1.0, canvas.width, canvas.height)
}

function rotateAround(v, axis, angle)
{
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const parallel = mul(axis, dot(axis, v))
    const perpendicular = sub(v, parallel)
    const crossPart = cross(axis, v)
    return add(add(parallel, mul(perpendicular, c)), mul(crossPart, s))
}

function mixScalar(a, b, t)
{
    return a * (1 - t) + b * t
}

/**
 * Inverse bilinear sample of the height grid at world (x, z).
 * Off-grid positions are clamped so the program does not crash.
 */
function terrainHeightAt(x, z)
{
    const n = window.gridN
    const step = window.gridStep
    if (!window.heights || n < 2 || step <= 0) return 0

    let u = (x + 1) / step
    let v = (z + 1) / step
    u = Math.max(0, Math.min(n - 1, u))
    v = Math.max(0, Math.min(n - 1, v))

    const i0 = Math.min(Math.floor(u), n - 2)
    const j0 = Math.min(Math.floor(v), n - 2)
    const tx = u - i0
    const ty = v - j0

    const h00 = window.heights[j0 * n + i0]
    const h10 = window.heights[j0 * n + i0 + 1]
    const h01 = window.heights[(j0 + 1) * n + i0]
    const h11 = window.heights[(j0 + 1) * n + i0 + 1]

    return mixScalar(mixScalar(h00, h10, tx), mixScalar(h01, h11, tx), ty)
}

function updateCamera(dt)
{
    let eye = window.eye
    let forward = window.forward
    const right = normalize(cross(forward, WORLD_UP))

    if (keysBeingPressed['w']) eye = add(eye, mul(forward, MOVE_SPEED * dt))
    if (keysBeingPressed['s']) eye = add(eye, mul(forward, -MOVE_SPEED * dt))
    if (keysBeingPressed['a']) eye = add(eye, mul(right, -MOVE_SPEED * dt))
    if (keysBeingPressed['d']) eye = add(eye, mul(right, MOVE_SPEED * dt))

    if (keysBeingPressed['ArrowLeft'])
    {
        forward = normalize(rotateAround(forward, WORLD_UP, TURN_SPEED * dt))
    }
    if (keysBeingPressed['ArrowRight'])
    {
        forward = normalize(rotateAround(forward, WORLD_UP, -TURN_SPEED * dt))
    }
    if (keysBeingPressed['ArrowUp'] || keysBeingPressed['ArrowDown'])
    {
        const pitchRight = normalize(cross(forward, WORLD_UP))
        const pitch = keysBeingPressed['ArrowUp'] ? TURN_SPEED * dt : -TURN_SPEED * dt
        const pitched = normalize(rotateAround(forward, pitchRight, pitch))
        const pitchAngle = Math.asin(Math.max(-1, Math.min(1, pitched[1])))
        if (Math.abs(pitchAngle) < MAX_PITCH)
        {
            forward = pitched
        }
    }

    eye[1] = terrainHeightAt(eye[0], eye[2]) + CAMERA_HEIGHT

    window.eye = eye
    window.forward = forward
}

function generateTerrain(gridsize, faults)
{
    const n = gridsize
    const positions = new Array(n * n)
    const step = n === 1 ? 0 : 2 / (n - 1)

    for(let row=0; row<n; row+=1)
    {
        for(let col=0; col<n; col+=1)
        {
            const x = -1 + col * step
            const z = -1 + row * step
            positions[row * n + col] = [x, 0, z]
        }
    }

    if (faults <= 0)
    {
        const r = 1
        for(let i=0; i<positions.length; i+=1)
        {
            const x = positions[i][0]
            const z = positions[i][2]
            const d = Math.sqrt(x * x + z * z)
            positions[i][1] = (r >= d) ? Math.sqrt(r * r - d * d) : 0
        }
    }
    else
    {
        for(let f=0; f<faults; f+=1)
        {
            const p0 = positions[Math.floor(Math.random() * positions.length)]
            const theta = Math.random() * Math.PI * 2
            const nx = Math.cos(theta)
            const nz = Math.sin(theta)
            for(let i=0; i<positions.length; i+=1)
            {
                const dx = positions[i][0] - p0[0]
                const dz = positions[i][2] - p0[2]
                if (dx * nx + dz * nz > 0)
                {
                    positions[i][1] += 1
                }
                else
                {
                    positions[i][1] -= 1
                }
            }
        }

        let minH = Infinity
        let maxH = -Infinity
        for(let i=0; i<positions.length; i+=1)
        {
            const h = positions[i][1]
            if (h < minH) minH = h
            if (h > maxH) maxH = h
        }
        const range = maxH - minH
        if (range > 0)
        {
            const mid = 0.5 * (maxH + minH)
            for(let i=0; i<positions.length; i+=1)
            {
                positions[i][1] = HEIGHT_SCALE * (positions[i][1] - mid) / range
            }
        }
    }

    window.gridN = n
    window.gridStep = step
    window.heights = new Float32Array(n * n)
    for(let i=0; i<positions.length; i+=1)
    {
        window.heights[i] = positions[i][1]
    }

    const normals = computeGridNormals(positions, n)
    const triangles = []
    for(let row=0; row<n-1; row+=1)
    {
        for(let col=0; col<n-1; col+=1)
        {
            const i = row * n + col
            triangles.push([i, i + n, i + 1])
            triangles.push([i + 1, i + n, i + n + 1])
        }
    }

    return {
        triangles: triangles,
        attributes: [positions, normals]
    }
}

function computeGridNormals(positions, n)
{
    const normals = new Array(n * n)
    for(let row=0; row<n; row+=1)
    {
        for(let col=0; col<n; col+=1)
        {
            const i = row * n + col
            const v = positions[i]
            const north = (row > 0) ? positions[i - n] : v
            const south = (row < n - 1) ? positions[i + n] : v
            const east = (col < n - 1) ? positions[i + 1] : v
            const west = (col > 0) ? positions[i - 1] : v
            normals[i] = normalize(cross(sub(north, south), sub(west, east)))
        }
    }
    return normals
}

function draw()
{
    gl.clearColor(1, 1, 1, 1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    if (!window.geom) return

    gl.bindVertexArray(geom.vao)

    gl.uniform4fv(program.uniforms.color, EarthTone)
    gl.uniform3fv(program.uniforms.lightdir, LIGHT_DIR)
    gl.uniform3fv(program.uniforms.lightcolor, [1, 1, 1])
    gl.uniform3fv(program.uniforms.eyepos, window.eye)

    const center = add(window.eye, window.forward)
    const v = m4view(window.eye, center, WORLD_UP)
    gl.uniformMatrix4fv(program.uniforms.mv, false, v)
    gl.uniformMatrix4fv(program.uniforms.p, false, p)

    gl.drawElements(geom.mode, geom.count, geom.type, 0)
}

function tick(milliseconds)
{
    const dt = window.lastTime === null ? 0 : (milliseconds - window.lastTime) / 1000
    window.lastTime = milliseconds
    updateCamera(dt)
    draw()
    requestAnimationFrame(tick)
}

async function loadText(path)
{
    const res = await fetch(path)
    if (!res.ok)
    {
        throw Error('Failed to load ' + path + ' (open this page via http://localhost, not as a file)')
    }
    return res.text()
}

window.addEventListener('load', setup)
