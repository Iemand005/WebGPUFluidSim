class FluidSimulation {

    /** @param {HTMLCanvasElement} canvas */
    constructor(canvas) {
        this.canvas = canvas;

        this.context = canvas.getContext('webgpu');
    }

    async initGPU() {
        // TypeScript will now auto-complete navigator.gpu, GPUDevice, etc.
        const adapter = await navigator.gpu.requestAdapter();
    }

}