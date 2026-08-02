
const shaderSource = `
struct Particle {
    pos: vec2<f32>,
    vel: vec2<f32>,
}

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;

// --- COMPUTE SHADER (Simulatie) ---
@compute @workgroup_size(64)
fn computeMain(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.x;
    if (index >= arrayLength(&particles)) { return; }

    var p = particles[index];

    // Voeg simpele zwaartekracht toe
    p.vel.y -= 0.0005;

    // Update positie gebaseerd op snelheid
    p.pos += p.vel;

    // Botsing met de randen van het scherm (-1.0 tot 1.0)
    if (p.pos.x < -1.0 || p.pos.x > 1.0) { p.vel.x *= -0.8; p.pos.x = clamp(p.pos.x, -1.0, 1.0); }
    if (p.pos.y < -1.0 || p.pos.y > 1.0) { p.vel.y *= -0.8; p.pos.y = clamp(p.pos.y, -1.0, 1.0); }

    // Sla de update op
    particles[index] = p;
}

// --- RENDER SHADER (Visualisatie) ---
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
}

@vertex
fn vertexMain(@location(0) pos: vec2<f32>) -> VertexOutput {
    var output: VertexOutput;
    // Zet de 2D positie om naar 4D clip space clip-space
    output.position = vec4<f32>(pos, 0.0, 1.0);
    return output;
}

@fragment
fn fragmentMain() -> @location(0) vec4<f32> {
    // Kleur de deeltjes cyaan/blauwachtig
    return vec4<f32>(0.0, 0.7, 1.0, 1.0);
}
`;

class FluidSimulation {

	/** @param {HTMLCanvasElement} canvas */
	constructor(canvas) {
		this.canvas = canvas;

		this.device = null;

		this.context = canvas.getContext("webgpu");

		if (!this.context) throw new Error("Failed to initialize the canvas webgpu context.");

		this.format = "";
	}

	async initGPU() {
		if (!navigator.gpu) throw new Error("WebGPU is not supported by your current browser engine.");

		const adapter = await navigator.gpu.requestAdapter();
		// adapter.

		this.device = await adapter.requestDevice();

		this.format = navigator.gpu.getPreferredCanvasFormat();

		this.context.configure({ device: this.device, format: this.format, alphaMode: "opaque" });

		console.log("WebGPU initialization complete! Context bound successfully.");
		return true;
	}

	initBuffers(numParticles = 5000) {
		this.numParticles = numParticles;

		const particleData = new Float32Array(numParticles * 4);

		for (let i = 0; i < numParticles; i++) {
			particleData[i * 4 + 0] = (Math.random() * 2) - 1; // x
			particleData[i * 4 + 1] = (Math.random() * 2) - 1; // y
			particleData[i * 4 + 2] = (Math.random() - 0.5) * 0.1; // vx
			particleData[i * 4 + 3] = (Math.random() - 0.5) * 0.1; // vy
		}

		// Belangrijk: STORAGE (voor compute) én VERTEX (voor renderen)
		this.particleBuffer = this.device.createBuffer({
			label: "Particle Buffer",
			size: particleData.byteLength,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
			mappedAtCreation: true
		});

		new Float32Array(this.particleBuffer.getMappedRange()).set(particleData);
		this.particleBuffer.unmap();
	}

	initPipelines() {
		const shaderModule = this.device.createShaderModule({ code: shaderSource });

		// 1. Compute Pipeline Setup
		this.computePipeline = this.device.createComputePipeline({
			label: "Simulation Pipeline",
			layout: "auto",
			compute: { module: shaderModule, entryPoint: "computeMain" }
		});

		// Koppel onze deeltjesbuffer aan @group(0) @binding(0) van de compute shader
		this.computeBindGroup = this.device.createBindGroup({
			layout: this.computePipeline.getBindGroupLayout(0),
			entries: [{ binding: 0, resource: { buffer: this.particleBuffer } }]
		});

		// 2. Render Pipeline Setup
		this.renderPipeline = this.device.createRenderPipeline({
			label: "Renderer Pipeline",
			layout: "auto",
			vertex: {
				module: shaderModule,
				entryPoint: "vertexMain",
				buffers: [{
					arrayStride: 16, // 4 floats * 4 bytes (pos.x, pos.y, vel.x, vel.y)
					attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] // Lees alleen pos (eerste 2 floats)
				}]
			},
			fragment: {
				module: shaderModule,
				entryPoint: "fragmentMain",
				targets: [{ format: this.format }]
			},
			primitive: {
				topology: "point-list" // Teken elk vertex als een losse stip
			}
		});
	}


}

const canvas = document.getElementById("canvas");
const fluidSimulation = new FluidSimulation(canvas);

fluidSimulation.initGPU().then(() => {
	fluidSimulation.initBuffers();

	simulation.initBuffers(10000);

	simulation.initPipelines();
    simulation.frame();
});