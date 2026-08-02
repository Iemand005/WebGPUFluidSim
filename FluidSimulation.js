
const shaderSource = /* wgsl */`
struct Particle {
    pos: vec2<f32>,
    vel: vec2<f32>,
}

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;

// --- COMPUTE SHADER (Simulatie) ---
@compute @workgroup_size(64)
fn computeMain(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.x;
    let num_particles = arrayLength(&particles);
    if (index >= num_particles) { return; }

    var p = particles[index];

    // --- VLOEISTOF INSTELLINGEN ---
    let interaction_radius = 0.06; // Hoe ver deeltjes elkaar beïnvloeden
    let repel_strength = 0.0003;   // Kracht waarmee ze elkaar wegduwen
    let gravity = 0.0004;          // Kracht van de zwaartekracht naar beneden
    let damping = 0.97;            // Viscositeit / weerstand (voorkomt chaos)

    var pressure_force = vec2<f32>(0.0, 0.0);

    // --- LUS DOOR ALLE DEELTJES (Interactie) ---
    for (var i = 0u; i < num_particles; i = i + 1u) {
        if (i == index) { continue; } // Sla jezelf over

        let other = particles[i];
        let dir = p.pos - other.pos;
        let dist = length(dir);

        // Als een ander deeltje te dichtbij is, duw het weg
        if (dist < interaction_radius && dist > 0.0001) {
            // Hoe dichterbij, hoe sterker de afstoting (lineaire afname)
            let overlap = interaction_radius - dist;
            let force = (overlap / interaction_radius) * repel_strength;
            
            pressure_force += normalize(dir) * force;
        }
    }

    // --- KRCHTEN TOEPASSEN & INTEGRATIE ---
    p.vel += pressure_force;
    p.vel.y -= gravity;     // Zwaartekracht naar beneden trekken
    p.vel *= damping;       // Snelheid dempen voor stroperigheid

    // Update de positie
    p.pos += p.vel;

    // --- BOTSER DETECTIE (Grenzen van het scherm) ---
    let bound = 0.95; // Blijf net binnen de -1.0 en 1.0 clip space grenzen
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
    // Zet de 2D positie om naar 4D clip-space
    output.position = vec4<f32>(pos, 0.0, 1.0);
    return output;
}

@fragment
fn fragmentMain() -> @location(0) vec4<f32> {
    // Kleur de vloeistof rood (zoals in jouw origineel)
    return vec4<f32>(1.0, 0.0, 0.0, 1.0);
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

	frame() {
		const commandEncoder = this.device.createCommandEncoder();

		// --- 1. COMPUTE PASS (Simulatie) ---
		const computePass = commandEncoder.beginComputePass();
		computePass.setPipeline(this.computePipeline);
		computePass.setBindGroup(0, this.computeBindGroup);
		// Bereken hoeveel workgroups we nodig hebben (numParticles / workgroup_size van 64)
		const workgroupCount = Math.ceil(this.numParticles / 64);
		computePass.dispatchWorkgroups(workgroupCount);
		computePass.end();

		// --- 2. RENDER PASS (Tekenen) ---
		const renderPass = commandEncoder.beginRenderPass({
			colorAttachments: [{
				view: this.context.getCurrentTexture().createView(),
				clearValue: { r: 0.05, g: 0.05, b: 0.08, a: 1.0 }, // Donkere achtergrond
				loadOp: "clear",
				storeOp: "store"
			}]
		});
		renderPass.setPipeline(this.renderPipeline);
		renderPass.setVertexBuffer(0, this.particleBuffer); // Geef de buffer direct als vertex input
		renderPass.draw(this.numParticles);
		renderPass.end();

		// Submit alles in één keer naar de GPU
		this.device.queue.submit([commandEncoder.finish()]);

		// Volgende frame aanvragen
		requestAnimationFrame(() => this.frame());
	}



}

const canvas = document.getElementById("canvas");
const fluidSimulation = new FluidSimulation(canvas);

fluidSimulation.initGPU().then(() => {
	fluidSimulation.initBuffers();

	fluidSimulation.initBuffers(10000);

	fluidSimulation.initPipelines();
    fluidSimulation.frame();
});