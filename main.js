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
const audioChannelSelect = document.getElementById('audio-channel-select');
const btnAddPrecise = document.getElementById('btn-add-precise');
const cutStart = document.getElementById('cut-start');
const cutEnd = document.getElementById('cut-end');
const zoomSlider = document.getElementById('zoom-slider');
const currentTimeDisplay = document.getElementById('current-time-display');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const mainVideo = document.getElementById('main-video');

let wavesurfer;
let wsRegions;
let activeVideoFile = null;
let ffmpeg = null;

// Helper to format seconds into mm:ss
function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}

// Helper to parse mm:ss or seconds into raw seconds
function parseTime(input) {
    if (!input) return NaN;
    if (input.includes(':')) {
        const parts = input.split(':');
        return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return parseFloat(input);
}

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
        cursorWidth: 2,
        autoScroll: true,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: wfHeight,
        normalize: true,
        minPxPerSec: (zoomSlider && Number(zoomSlider.value)) || 1,
        plugins: [
            TimelinePlugin.create({
                container: '#waveform-timeline',
                formatTimeCallback: (seconds) => {
                    const m = Math.floor(seconds / 60);
                    const s = Math.floor(seconds % 60);
                    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : s;
                }
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
        if (currentTimeDisplay) {
            currentTimeDisplay.textContent = formatTime(currentTime);
        }
        
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

if (zoomSlider) {
    zoomSlider.addEventListener('input', (e) => {
        if (wavesurfer) {
            wavesurfer.zoom(Number(e.target.value));
        }
    });
}

if (btnAddPrecise) {
    btnAddPrecise.addEventListener('click', () => {
        const start = parseTime(cutStart.value);
        const end = parseTime(cutEnd.value);
        const duration = wavesurfer.getDuration();
        
        if (isNaN(start) || isNaN(end) || start >= end || start < 0 || end > duration) {
            alert('Please enter valid start and end times (e.g., 1:30 or 90.5) within the video duration.');
            return;
        }
        
        wsRegions.addRegion({
            start: start,
            end: end,
            color: 'rgba(239, 68, 68, 0.4)', // Danger red
            drag: true,
            resize: true
        });
        
        cutStart.value = '';
        cutEnd.value = '';
    });
}

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
        const audioMode = audioChannelSelect ? audioChannelSelect.value : 'both';

        if (keepSegments.length === 1) {
            // Only one segment kept, simple trim without concat filter
            const seg = keepSegments[0];
            const execArgs = [
                '-i', 'input.mp4',
                '-ss', seg.start.toString(),
                '-to', seg.end.toString(),
                '-c:v', 'libx264'
            ];

            if (audioMode === 'none') {
                execArgs.push('-an');
            } else {
                execArgs.push('-c:a', 'aac');
                if (audioMode === 'left') {
                    execArgs.push('-af', 'pan=1c|c0=c0');
                } else if (audioMode === 'right') {
                    execArgs.push('-af', 'pan=1c|c0=c1');
                }
            }
            execArgs.push('output.mp4');
            await ff.exec(execArgs);
        } else {
            // Multiple segments, need to use filter_complex to trim and concat
            const filterParts = [];
            const concatInputs = [];
            keepSegments.forEach((seg, i) => {
                filterParts.push(`[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[v${i}]`);
                if (audioMode !== 'none') {
                    filterParts.push(`[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[a${i}]`);
                    concatInputs.push(`[v${i}][a${i}]`);
                } else {
                    concatInputs.push(`[v${i}]`);
                }
            });
            
            const execArgs = ['-i', 'input.mp4'];
            let filterString = "";
            
            if (audioMode === 'none') {
                filterString = `${filterParts.join(';')};${concatInputs.join('')}concat=n=${keepSegments.length}:v=1:a=0[outv]`;
                execArgs.push('-filter_complex', filterString, '-map', '[outv]', '-c:v', 'libx264', '-an', 'output.mp4');
            } else {
                filterString = `${filterParts.join(';')};${concatInputs.join('')}concat=n=${keepSegments.length}:v=1:a=1[outv][outa]`;
                
                if (audioMode === 'left') {
                    filterString += `;[outa]pan=1c|c0=c0[finala]`;
                    execArgs.push('-filter_complex', filterString, '-map', '[outv]', '-map', '[finala]', '-c:v', 'libx264', '-c:a', 'aac', 'output.mp4');
                } else if (audioMode === 'right') {
                    filterString += `;[outa]pan=1c|c0=c1[finala]`;
                    execArgs.push('-filter_complex', filterString, '-map', '[outv]', '-map', '[finala]', '-c:v', 'libx264', '-c:a', 'aac', 'output.mp4');
                } else {
                    execArgs.push('-filter_complex', filterString, '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-c:a', 'aac', 'output.mp4');
                }
            }
            
            await ff.exec(execArgs);
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