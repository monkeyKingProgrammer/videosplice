# VideoSplice

A powerful, entirely browser-based minimalist video cutter and editor. VideoSplice allows you to precisely slice, cut, and edit video files locally on your machine without uploading gigabytes of data to a cloud server. 

It leverages the incredible **FFmpeg.wasm** (WebAssembly) to perform professional-grade video encoding and processing directly inside your browser's memory, ensuring total privacy, blazing-fast rendering, and zero server costs.

## Features

*   **Synchronized Video & Audio Preview:** The UI embeds a dedicated video player securely linked to a high-performance audio waveform engine (Wavesurfer.js), meaning the video and audio waveform play in perfect, frame-accurate synchronization.
*   **Visual Trimming:** Click "Add Cut Region" to drop red markers directly onto the waveform. Drag the handles to cover the exact parts of the video you want to cut out.
*   **Live Preview:** When you play the video, it seamlessly skips over your cut regions so you can instantly see and hear what the final result will look like.
*   **Browser-Based Encoding:** Click "Save MP4" and FFmpeg will automatically run a complex filter graph in the background, trimming out the red parts and concatenating the kept pieces together into a clean, new `.mp4` file saved instantly to your Downloads folder.
*   **Mobile Responsive:** Fully optimized UI for mobile devices, automatically adjusting layouts and touch-targets based on screen size.

## How to Run Locally

You must have [Node.js](https://nodejs.org/) installed.

1. Clone or download this repository.
2. Open your terminal in the `videoSplice` directory.
3. Install the dependencies:
   ```bash
   npm install
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```
5. Open your browser and navigate to `http://localhost:5173` (or whichever port Vite assigns).

*Note: Because FFmpeg.wasm requires `SharedArrayBuffer` for high-performance memory access, the Vite server is explicitly configured to send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers. These are required for the video engine to boot up.*

## Deployment

If you deploy this to a live server (like Nginx), you **must** configure your server to send the strict cross-origin security headers, or the browser will block the FFmpeg WebAssembly engine. 

Example Nginx configuration:
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    root /var/www/videosplice;
    index index.html;

    location / {
        add_header Cross-Origin-Opener-Policy "same-origin" always;
        add_header Cross-Origin-Embedder-Policy "require-corp" always;
        try_files $uri $uri/ /index.html;
    }
}
```

## Privacy & Security
Because this tool runs 100% inside your web browser, your video files are **never** uploaded to the internet. They are decoded and processed entirely within your machine's local memory.

## License
[MIT License](LICENSE)