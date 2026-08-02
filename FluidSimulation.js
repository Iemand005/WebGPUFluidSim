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

}

const canvas = document.getElementById("canvas");
const fluidSimulation = new FluidSimulation(canvas);

window.onload = () => {
	fluidSimulation.initGPU().then(() => {
		// Additional initialization code can go here
	}
}