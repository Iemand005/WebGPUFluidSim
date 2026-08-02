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

}

const canvas = document.getElementById("canvas");
const fluidSimulation = new FluidSimulation(canvas);

fluidSimulation.initGPU().then(() => {
	fluidSimulation.initBuffers();
});