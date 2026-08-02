class FluidSimulation {

    /** @param {HTMLCanvasElement} canvas */
    constructor(canvas) {
        this.canvas = canvas;

        this.context = canvas.getContext('webgpu');
    }

}