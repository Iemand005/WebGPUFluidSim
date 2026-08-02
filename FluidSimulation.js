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

        this.device = await adapter.requestDevice();

        this.format = navigator.gpu.getPreferredCanvasFormat();
    }

}