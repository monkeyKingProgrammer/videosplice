import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

// DOM Elements
const videoInput = document.getElementById('video-input');
const fileNameDisplay = document.getElementById('file-name');
const uploadSection = document.getElementById('upload-section');
const editorSection = document.getElementById('editor-section');
const btnPlayPause = document.getElementById('btn-play-pause');
const btnAddRegion = document.getElementById('btn-add-region');
const btnExportMp4 = document.getElementById('btn-export-mp4');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const mainVideo = document.getElementById('main-video');

let wavesurfer;
let wsRegions;
let activeVideoFile = null;
let ffmpeg = null;

function showLoading(text) {
    loadingText.textContent = text;
    loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    loadingOverlay.classList.add('hidden');
}

// Initialize FFmpeg
async function initFFmpeg() {
    if (ffmpeg) return ffmpeg;
    showLoading('Loading FFmpeg engine...');
    ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => {
        console.log(message);
    });
    ffmpeg.on('progress', ({ progress }) => {
        const percent = Math.round(progress * 100);
        loadingText.textContent = `Processing Video... ${percent}%`;
    });
    await ffmpeg.load();
    hideLoading();
    return ffmpeg;
}

// Initialize Wavesurfer
function initWavesurfer() {
    if (wavesurfer) {
        wavesurfer.destroy();
    }

    const isMobile = window.innerWidth <= 600;
    const wfHeight = isMobile ? 60 : 80;

    wavesurfer = WaveSurfer.create({
        container: '#waveform',
        media: mainVideo, // Sync directly with the <video> element!
        waveColor: '#3b82f6',
        progressColor: '#2563eb',
        cursorColor: '#ffffff',
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: wfHeight,
        normalize: true,
        plugins: [
            TimelinePlugin.create({
                container: '#waveform-timeline',
            }),
        ],
    });

    wsRegions = wavesurfer.registerPlugin(RegionsPlugin.create());

    wavesurfer.on('play', () => {
        btnPlayPause.textContent = 'Pause';
    });
    wavesurfer.on('pause', () => {
        btnPlayPause.textContent = 'Play';
    });

    // Skip logic for regions (preview cuts)
    wavesurfer.on('timeupdate', (currentTime) => {
        const regions = wsRegions.getRegions();
        for (const region of regions) {
            // If the playhead is inside a region, skip to the end of it
            if (currentTime >= region.start && currentTime < region.end) {
                wavesurfer.setTime(region.end);
                break;
            }
        }
    });
}

// Handle file upload
videoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    activeVideoFile = file;
    fileNameDisplay.textContent = file.name;
    uploadSection.classList.add('hidden');
    editorSection.classList.remove('hidden');

    initWavesurfer();
    
    const objectUrl = URL.createObjectURL(file);
    mainVideo.src = objectUrl;
    wavesurfer.load(objectUrl); // MUST call load to draw the waveform and initialize the cursor!
    
    // Init FFmpeg in background
    initFFmpeg();
});

// Controls
btnPlayPause.addEventListener('click', () => {
    wavesurfer.playPause();
});

btnAddRegion.addEventListener('click', () => {
    const duration = wavesurfer.getDuration();
    const currentTime = wavesurfer.getCurrentTime();
    
    wsRegions.addRegion({
        start: currentTime,
        end: Math.min(currentTime + 5, duration),
        color: 'rgba(239, 68, 68, 0.4)', // Danger red
        drag: true,
        resize: true
    });
});

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// Export Video via FFmpeg
btnExportMp4.addEventListener('click', async () => {
    const regions = wsRegions.getRegions()
        .map(r => ({ start: r.start, end: r.end }))
        .sort((a, b) => a.start - b.start);

    // Merge overlapping regions
    const mergedRegions = [];
    if (regions.length > 0) {
        let current = regions[0];
        for (let i = 1; i < regions.length; i++) {
            const next = regions[i];
            if (next.start <= current.end) {
                current.end = Math.max(current.end, next.end);
            } else {
                mergedRegions.push(current);
                current = next;
            }
        }
        mergedRegions.push(current);
    }

    const duration = wavesurfer.getDuration();
    
    // Determine segments to KEEP
    const keepSegments = [];
    let currentTime = 0;
    for (const region of mergedRegions) {
        if (region.start > currentTime) {
            keepSegments.push({ start: currentTime, end: region.start });
        }
        currentTime = region.end;
    }
    if (currentTime < duration) {
        keepSegments.push({ start: currentTime, end: duration });
    }

    if (keepSegments.length === 0) {
        alert('Cannot save empty video. Adjust regions.');
        return;
    }

    try {
        const ff = await initFFmpeg();
        showLoading('Reading video file into memory...');
        
        await ff.writeFile('input.mp4', await fetchFile(activeVideoFile));

        if (keepSegments.length === 1 && keepSegments[0].start === 0 && keepSegments[0].end === duration) {
            // Nothing was cut
            alert("No cuts were made. You can just use the original file.");
            hideLoading();
            return;
        }

        showLoading('Processing Video... 0%');

        if (keepSegments.length === 1) {
            // Only one segment kept, simple trim without concat filter
            const seg = keepSegments[0];
            await ff.exec([
                '-i', 'input.mp4',
                '-ss', seg.start.toString(),
                '-to', seg.end.toString(),
                '-c:v', 'libx264',
                '-c:a', 'aac',
                'output.mp4'
            ]);
        } else {
            // Multiple segments, need to use filter_complex to trim and concat
            const filterParts = [];
            const concatInputs = [];
            keepSegments.forEach((seg, i) => {
                filterParts.push(`[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[v${i}]`);
                filterParts.push(`[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[a${i}]`);
                concatInputs.push(`[v${i}][a${i}]`);
            });
            const filterString = `${filterParts.join(';')};${concatInputs.join('')}concat=n=${keepSegments.length}:v=1:a=1[outv][outa]`;
            
            await ff.exec([
                '-i', 'input.mp4',
                '-filter_complex', filterString,
                '-map', '[outv]',
                '-map', '[outa]',
                '-c:v', 'libx264',
                '-c:a', 'aac',
                'output.mp4'
            ]);
        }

        const data = await ff.readFile('output.mp4');
        const blob = new Blob([data.buffer], { type: 'video/mp4' });
        
        const originalName = activeVideoFile.name.replace(/\.[^/.]+$/, "");
        triggerDownload(blob, `${originalName}_spliced.mp4`);
        
    } catch (e) {
        console.error(e);
        alert('Error processing video: ' + e.message);
    } finally {
        hideLoading();
    }
});