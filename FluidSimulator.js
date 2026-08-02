
const shaderSource = /* wgsl */`
struct Particle {
    pos: vec2<f32>,
    vel: vec2<f32>,
}

struct MouseState {
    pos: vec2<f32>,
    vel: vec2<f32>,
    radius: f32,
    is_active: u32,
}

struct SimParams {
    deltaTime: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
}

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read> mouseState: MouseState;
@group(0) @binding(2) var<uniform> simParams: SimParams;

// --- COMPUTE SHADER (Simulatie) ---
@compute @workgroup_size(64)
fn computeMain(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.x;
    let num_particles = arrayLength(&particles);
    if (index >= num_particles) { return; }

    var p = particles[index];

    // --- VLOEISTOF INSTELLINGEN ---
    let dt = max(simParams.deltaTime, 0.0001);
    let dtScale = dt * 60.0;
    let interaction_radius = 0.06;
    let repel_strength = 0.0003;
    let gravity = 0.0004;
    let damping = 0.97;

    var pressure_force = vec2<f32>(0.0, 0.0);

    // --- LUS DOOR ALLE DEELTJES (Interactie) ---
    for (var i = 0u; i < num_particles; i = i + 1u) {
        if (i == index) { continue; }

        let other = particles[i];
        let dir = p.pos - other.pos;
        let dist = length(dir);

        if (dist < interaction_radius && dist > 0.0001) {
            let overlap = interaction_radius - dist;
            let force = (overlap / interaction_radius) * repel_strength * dtScale;
            pressure_force += normalize(dir) * force;
        }
    }

    // --- MOUSE INTERACTION ---
    let to_mouse = p.pos - mouseState.pos;
    let mouse_dist = length(to_mouse);
    if (mouse_dist < mouseState.radius && mouse_dist > 0.0001) {
        let influence = 1.0 - (mouse_dist / mouseState.radius);
        let mouse_force = normalize(to_mouse) * influence * 0.0035 * dtScale;

        if (mouseState.is_active != 0u) {
            p.vel -= mouse_force;
            p.vel += mouseState.vel * 0.003;
        } else {
            p.vel += mouse_force;
        }
    }

    // --- KRACHTEN TOEPASSEN & INTEGRATIE ---
    p.vel += pressure_force;
    p.vel.y -= gravity * dtScale;
    p.vel *= damping;

    // Update de positie
    p.pos += p.vel * dtScale;

    // --- BOTSER DETECTIE (Grenzen van het scherm) ---
    let bound = 0.95;
    if (p.pos.x < -bound) { p.pos.x = -bound; p.vel.x *= -0.5; }
    if (p.pos.x >  bound) { p.pos.x =  bound; p.vel.x *= -0.5; }
    if (p.pos.y < -bound) { p.pos.y = -bound; p.vel.y *= -0.5; }
    if (p.pos.y >  bound) { p.pos.y =  bound; p.vel.y *= -0.5; }

    // Sla de bijgewerkte data op in de GPU buffer
    particles[index] = p;
}

// --- RENDER SHADER (Visualisatie) ---
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
}

@vertex
fn vertexMain(@location(0) pos: vec2<f32>) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4<f32>(pos, 0.0, 1.0);
    return output;
}

@fragment
fn fragmentMain() -> @location(0) vec4<f32> {
    return vec4<f32>(1.0, 0.0, 0.0, 1.0);
}
`;

class FluidSimulator {

	/** @param {HTMLCanvasElement} canvas */
	constructor(canvas) {
		this.canvas = canvas;
		this.device = null;
		this.context = canvas.getContext("webgpu");

		if (!this.context) throw new Error("Failed to initialize the canvas webgpu context.");

		this.format = "";
		this.numParticles = 0;
		this.mouseState = { x: 0, y: 0, vx: 0, vy: 0, radius: 0.18, isActive: 0 };
		this.pointerActive = false;
		this.lastFrameTime = performance.now();
		this.pendingResize = null;
		this.resizeFrameRequested = false;
		this.needsClear = true;
		this.contextConfigured = false;
		this.resizeDebounceHandle = null;
		this.isResizing = false;

		this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
		this.resizeObserver.observe(this.canvas);

		this.canvas.addEventListener("pointermove", (event) => this.handlePointerMove(event));
		this.canvas.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
		this.canvas.addEventListener("pointerup", () => this.handlePointerUp());
		this.canvas.addEventListener("pointerleave", () => this.handlePointerUp());
		this.canvas.addEventListener("pointercancel", () => this.handlePointerUp());
	}

	async initGPU() {
		if (!navigator.gpu) throw new Error("WebGPU is not supported by your current browser engine.");

		const adapter = await navigator.gpu.requestAdapter();
		this.device = await adapter.requestDevice();

		this.format = navigator.gpu.getPreferredCanvasFormat();
		this.resizeCanvas();

		console.log("WebGPU initialization complete! Context bound successfully.");
		return true;
	}

	resizeCanvas() {
		if (!this.device || !this.context) return;

		const width = Math.max(1, Math.floor(this.canvas.clientWidth));
		const height = Math.max(1, Math.floor(this.canvas.clientHeight));
		const sizeChanged = this.canvas.width !== width || this.canvas.height !== height;

		if (!this.contextConfigured) {
			if (sizeChanged) {
				this.canvas.width = width;
				this.canvas.height = height;
			}

			this.context.configure({
				device: this.device,
				format: this.format,
				alphaMode: "premultiplied"
			});
			this.contextConfigured = true;
			this.needsClear = true;
			return;
		}

		if (!sizeChanged) return;

		this.pendingResize = { width, height };
		this.isResizing = true;

		if (this.resizeDebounceHandle) {
			clearTimeout(this.resizeDebounceHandle);
		}

		this.resizeDebounceHandle = setTimeout(() => {
			this.resizeDebounceHandle = null;
			if (!this.pendingResize) return;

			const nextSize = this.pendingResize;
			this.pendingResize = null;

			if (this.canvas.width !== nextSize.width || this.canvas.height !== nextSize.height) {
				this.canvas.width = nextSize.width;
				this.canvas.height = nextSize.height;
			}

			this.context.configure({
				device: this.device,
				format: this.format,
				alphaMode: "premultiplied"
			});

			this.needsClear = true;
			this.isResizing = false;
		}, 80);
	}

	initBuffers(numParticles = 10000) {
		this.numParticles = numParticles;

		const particleData = new Float32Array(numParticles * 4);

		for (let i = 0; i < numParticles; i++) {
			particleData[i * 4 + 0] = (Math.random() * 2) - 1;
			particleData[i * 4 + 1] = (Math.random() * 2) - 1;
			particleData[i * 4 + 2] = (Math.random() - 0.5) * 0.1;
			particleData[i * 4 + 3] = (Math.random() - 0.5) * 0.1;
		}

		this.particleBuffer = this.device.createBuffer({
			label: "Particle Buffer",
			size: particleData.byteLength,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
			mappedAtCreation: true
		});

		new Float32Array(this.particleBuffer.getMappedRange()).set(particleData);
		this.particleBuffer.unmap();

		this.mouseBuffer = this.device.createBuffer({
			label: "Mouse State Buffer",
			size: 32,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
		});

		this.simParamsBuffer = this.device.createBuffer({
			label: "Simulation Parameters Buffer",
			size: 16,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});

		this.updateMouseBuffer();
		this.updateSimParamsBuffer(1 / 60);
	}

	initPipelines() {
		const shaderModule = this.device.createShaderModule({ code: shaderSource });

		this.computePipeline = this.device.createComputePipeline({
			label: "Simulation Pipeline",
			layout: "auto",
			compute: { module: shaderModule, entryPoint: "computeMain" }
		});

		this.computeBindGroup = this.device.createBindGroup({
			layout: this.computePipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: this.particleBuffer } },
				{ binding: 1, resource: { buffer: this.mouseBuffer } },
				{ binding: 2, resource: { buffer: this.simParamsBuffer } }
			]
		});

		this.renderPipeline = this.device.createRenderPipeline({
			label: "Renderer Pipeline",
			layout: "auto",
			vertex: {
				module: shaderModule,
				entryPoint: "vertexMain",
				buffers: [{
					arrayStride: 16,
					attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }]
				}]
			},
			fragment: {
				module: shaderModule,
				entryPoint: "fragmentMain",
				targets: [{ format: this.format }]
			},
			primitive: {
				topology: "point-list"
			}
		});
	}

	getNormalizedMousePosition(event) {
		const rect = this.canvas.getBoundingClientRect();
		const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		const y = 1 - ((event.clientY - rect.top) / rect.height) * 2;
		return { x, y };
	}

	handlePointerMove(event) {
		const pos = this.getNormalizedMousePosition(event);
		this.mouseState.vx = (pos.x - this.mouseState.x) * 0.5;
		this.mouseState.vy = (pos.y - this.mouseState.y) * 0.5;
		this.mouseState.x = pos.x;
		this.mouseState.y = pos.y;
		this.mouseState.isActive = this.pointerActive ? 1 : 0;
		this.updateMouseBuffer();
	}

	handlePointerDown(event) {
		this.canvas.setPointerCapture(event.pointerId);
		const pos = this.getNormalizedMousePosition(event);
		this.pointerActive = true;
		this.mouseState.x = pos.x;
		this.mouseState.y = pos.y;
		this.mouseState.vx = 0;
		this.mouseState.vy = 0;
		this.mouseState.isActive = 1;
		this.updateMouseBuffer();
	}

	handlePointerUp() {
		this.pointerActive = false;
		this.mouseState.isActive = 0;
		this.mouseState.vx = 0;
		this.mouseState.vy = 0;
		this.updateMouseBuffer();
	}

	updateMouseBuffer() {
		if (!this.mouseBuffer) return;

		const mouseData = new Float32Array(8);
		mouseData[0] = this.mouseState.x;
		mouseData[1] = this.mouseState.y;
		mouseData[2] = this.mouseState.vx;
		mouseData[3] = this.mouseState.vy;
		mouseData[4] = this.mouseState.radius;
		mouseData[5] = this.mouseState.isActive;
		mouseData[6] = 0;
		mouseData[7] = 0;

		this.device.queue.writeBuffer(this.mouseBuffer, 0, mouseData);
	}

	updateSimParamsBuffer(deltaTime) {
		if (!this.simParamsBuffer) return;

		const simData = new Float32Array(4);
		simData[0] = deltaTime;
		this.device.queue.writeBuffer(this.simParamsBuffer, 0, simData);
	}

	frame() {
		if (!this.contextConfigured || !this.device || !this.computePipeline || !this.renderPipeline || !this.particleBuffer) {
			requestAnimationFrame(() => this.frame());
			return;
		}

		const now = performance.now();
		const deltaTime = Math.min(0.033, Math.max(0.001, (now - this.lastFrameTime) / 1000));
		this.lastFrameTime = now;

		this.updateMouseBuffer();
		this.updateSimParamsBuffer(deltaTime);

		const commandEncoder = this.device.createCommandEncoder();

		const computePass = commandEncoder.beginComputePass();
		computePass.setPipeline(this.computePipeline);
		computePass.setBindGroup(0, this.computeBindGroup);
		const workgroupCount = Math.ceil(this.numParticles / 64);
		computePass.dispatchWorkgroups(workgroupCount);
		computePass.end();

		const renderPass = commandEncoder.beginRenderPass({
			colorAttachments: [{
				view: this.context.getCurrentTexture().createView(),
				clearValue: { r: 0.05, g: 0.05, b: 0.08, a: 0.0 },
				loadOp: this.needsClear && !this.isResizing ? "clear" : "load",
				storeOp: "store"
			}]
		});
		renderPass.setPipeline(this.renderPipeline);
		renderPass.setVertexBuffer(0, this.particleBuffer);
		renderPass.draw(this.numParticles);
		renderPass.end();

		this.needsClear = false;
		this.device.queue.submit([commandEncoder.finish()]);
		requestAnimationFrame(() => this.frame());
	}
}

const canvas = document.getElementById("canvas");
const fluidSimulation = new FluidSimulator(canvas);

fluidSimulation.initGPU().then(() => {
	fluidSimulation.initBuffers();
	fluidSimulation.initPipelines();
	fluidSimulation.frame();
});

window.oncontextmenu = e => e.preventDefault();