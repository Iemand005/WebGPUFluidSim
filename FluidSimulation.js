class FluidSimulation {

    /** @param {HTMLCanvasElement} canvas */
    constructor(canvas) {
        this.canvas = canvas;

        this.context = canvas.getContext('webgpu');
    }

    async initGPU() {
        if (!navigator.gpu) {
            this.showError("WebGPU is not supported by your current browser engine.");
            return false;
        }
        const adapter = await navigator.gpu.requestAdapter();
    }

}