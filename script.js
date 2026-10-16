// ============================================================
// 0. IMPORT MEDIAPIPE LOCALLY
// ============================================================
import {
    HandLandmarker,
    FilesetResolver,
    DrawingUtils
} from './libs/mediapipe/wasm/vision_bundle.mjs';

// ============================================================
// 1. GRAB HTML ELEMENTS
// ============================================================
const video = document.getElementById('webcam');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const detectionCanvas = document.createElement('canvas');
const detectionCtx = detectionCanvas.getContext('2d');
const statusDiv = document.getElementById('status');
const gestureStatusDiv = document.getElementById('gesture-status');
const slideCounterDiv = document.getElementById('slideCounter');

const drawCanvas = document.getElementById('drawCanvas');
const drawCtx = drawCanvas.getContext('2d');
const laserCanvas = document.getElementById('laserCanvas');
const laserCtx = laserCanvas.getContext('2d');
const homePage = document.getElementById('homePage');
const appShell = document.getElementById('appShell');
const homeScene = document.getElementById('homeScene');
const sceneMessage = document.getElementById('sceneMessage');

console.log("✅ Script loaded!");

// Drawing utility for skeleton
const drawingUtils = new DrawingUtils(ctx);

// ============================================================
// 2. SLIDE NAVIGATION
// ============================================================
let currentSlide = 0;
let slides = document.querySelectorAll('.slide');
let totalSlides = slides.length;

window.slides = slides;
window.totalSlides = totalSlides;
window.currentSlide = currentSlide;

function goToSlide(index) {
    window.slides = document.querySelectorAll('.slide');
    window.totalSlides = window.slides.length;

    if (window.totalSlides === 0) {
        console.log("⚠️ No slides to navigate");
        return;
    }

    index = ((index % window.totalSlides) + window.totalSlides) % window.totalSlides;

    window.slides.forEach((s, i) => {
        s.classList.toggle('active', i === index);
        const numberDiv = s.querySelector('.slide-number');
        if (numberDiv) {
            numberDiv.textContent = `${i + 1} / ${window.totalSlides}`;
        }
    });

    window.currentSlide = index;
    if (slideCounterDiv) {
        slideCounterDiv.textContent = `Slide ${index + 1} of ${window.totalSlides}`;
    }
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    console.log(`📄 goToSlide: ${index + 1} of ${window.totalSlides}`);
}

function nextSlide() {
    goToSlide(window.currentSlide + 1);
    console.log("➡️ Next Slide");
}

function prevSlide() {
    goToSlide(window.currentSlide - 1);
    console.log("⬅️ Previous Slide");
}

// ============================================================
// 3. DRAWING / LASER VARIABLES
// ============================================================
let isDrawing = false;
let lastX = null;
let lastY = null;

function setupDrawingCanvas() {
    const container = document.querySelector('.slideshow-container');
    if (container) {
        drawCanvas.width = container.clientWidth || 800;
        drawCanvas.height = container.clientHeight || 450;
        laserCanvas.width = drawCanvas.width;
        laserCanvas.height = drawCanvas.height;
    }
}
setupDrawingCanvas();
window.addEventListener('resize', setupDrawingCanvas);

// ============================================================
// 4. HELPER FUNCTIONS
// ============================================================
function getDistance(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function isFingerRaised(landmarks, tipIndex, baseIndex) {
    return landmarks[tipIndex].y < landmarks[baseIndex].y;
}

// ============================================================
// 5. THE GESTURE DETECTOR
// ============================================================
function detectGesture(landmarks, isRightHand) {
    if (isRightHand === null) {
        isRightHand = landmarks[0].x < landmarks[17].x;
    }

    const indexUp = isFingerRaised(landmarks, 8, 5);
    const middleUp = isFingerRaised(landmarks, 12, 9);
    const ringUp = isFingerRaised(landmarks, 16, 13);
    const pinkyUp = isFingerRaised(landmarks, 20, 17);

    const pinchDist = getDistance(landmarks[4], landmarks[8]);
    const threeSupportFingersUp = middleUp && ringUp && pinkyUp;
    if (pinchDist < 0.07 && threeSupportFingersUp) {
        return "PINCH";
    }

    let thumbUp;
    if (isRightHand) {
        thumbUp = landmarks[4].x < landmarks[17].x;
    } else {
        thumbUp = landmarks[4].x > landmarks[17].x;
    }

    let raisedCount = 0;
    if (indexUp) raisedCount++;
    if (middleUp) raisedCount++;
    if (ringUp) raisedCount++;
    if (pinkyUp) raisedCount++;
    if (thumbUp) raisedCount++;

    if (raisedCount >= 4) return "OPEN_PALM";
    if (indexUp && !middleUp && !ringUp && !pinkyUp) return "POINT";
    if (raisedCount <= 1) return "FIST";
    return "NONE";
}

// ============================================================
// 6. SWIPE VARIABLES
// ============================================================
let wristHistory = [];
let swipeCooldownUntil = 0;
let smoothedPalmX = null;
const NEXT_SWIPE_MIN_DISTANCE = 0.055;
const NEXT_SWIPE_MIN_DURATION = 75;
const PREVIOUS_SWIPE_MIN_DISTANCE = 0.07;
const PREVIOUS_SWIPE_MIN_DURATION = 90;
const SWIPE_MAX_DURATION = 900;
const SWIPE_COOLDOWN_MS = 800;
const PALM_LANDMARKS = [0, 5, 9, 13, 17];

// ============================================================
// 7. INITIALIZE HAND LANDMARKER (OFFLINE)
// ============================================================
let handLandmarker = null;

async function initHandLandmarker() {
    const vision = await FilesetResolver.forVisionTasks('./libs/mediapipe/wasm');
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: './libs/mediapipe/hand_landmarker.task'
        },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
    });
    console.log('✅ HandLandmarker initialized (offline mode)');
}

// ============================================================
// 8. MAIN PROCESSING LOOP (REPLACES hands.onResults)
// ============================================================
function processFrame() {
    if (!handLandmarker || !video.videoWidth) {
        requestAnimationFrame(processFrame);
        return;
    }

    let results;
    try {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (detectionCanvas.width !== width || detectionCanvas.height !== height) {
            detectionCanvas.width = width;
            detectionCanvas.height = height;
        }
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        detectionCtx.save();
        detectionCtx.translate(width, 0);
        detectionCtx.scale(-1, 1);
        detectionCtx.drawImage(video, 0, 0, width, height);
        detectionCtx.restore();
        results = handLandmarker.detectForVideo(detectionCanvas, performance.now());
    } catch (e) {
        requestAnimationFrame(processFrame);
        return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    laserCtx.clearRect(0, 0, laserCanvas.width, laserCanvas.height);

    if (results.landmarks && results.landmarks.length > 0) {
        const landmarks = results.landmarks[0];

        const modelHandedness = results.handedness?.[0]?.[0]?.categoryName;
        const isRightHand = modelHandedness === "Right"
            ? true
            : modelHandedness === "Left"
                ? false
                : null;
        const handType = isRightHand === null
            ? "Unknown"
            : isRightHand ? "Right" : "Left";

        // Draw skeleton using DrawingUtils
        drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
            color: '#00ff88',
            lineWidth: 2
        });
        drawingUtils.drawLandmarks(landmarks, {
            color: '#ff3366',
            lineWidth: 2,
            radius: 4
        });

        const indexTip = landmarks[8];
        const x = indexTip.x * drawCanvas.width;
        const y = indexTip.y * drawCanvas.height;

        const gesture = detectGesture(landmarks, isRightHand);

        // --- LASER (POINT) ---
        if (gesture === "POINT") {
            laserCtx.beginPath();
            laserCtx.arc(x, y, 5, 0, 2 * Math.PI);
            laserCtx.fillStyle = '#ff1744';
            laserCtx.fill();
            laserCtx.lineWidth = 2;
            laserCtx.strokeStyle = '#ffffff';
            laserCtx.stroke();
            isDrawing = false;
            lastX = null;
            lastY = null;
        }
        // --- DRAWING (PINCH) ---
        else if (gesture === "PINCH") {
            if (!isDrawing) {
                isDrawing = true;
                lastX = x;
                lastY = y;
            } else {
                drawCtx.beginPath();
                drawCtx.moveTo(lastX, lastY);
                drawCtx.lineTo(x, y);
                drawCtx.strokeStyle = '#83c9dc';
                drawCtx.lineWidth = 3;
                drawCtx.lineCap = 'round';
                drawCtx.lineJoin = 'round';
                drawCtx.shadowBlur = 0;
                drawCtx.shadowColor = 'transparent';
                drawCtx.stroke();
                lastX = x;
                lastY = y;
            }
        }
        // --- ERASE (OPEN PALM) ---
        else if (gesture === "OPEN_PALM") {
            drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
            isDrawing = false;
            lastX = null;
            lastY = null;
        }
        // --- STOP DRAWING ---
        else {
            isDrawing = false;
            lastX = null;
            lastY = null;
        }

        // --- UPDATE GESTURE STATUS UI ---
        let displayText = gesture;
        let color = "#77817b";

        switch (gesture) {
            case "PINCH":
                displayText = "DRAWING";
                color = "#e3b778";
                break;
            case "POINT":
                displayText = "LASER";
                color = "#a3d2bf";
                break;
            case "OPEN_PALM":
                displayText = "ERASE";
                color = "#e59a91";
                break;
            case "FIST":
                displayText = "STOP";
                color = "#77817b";
        }

        gestureStatusDiv.textContent = displayText;
        gestureStatusDiv.style.borderColor = color;
        gestureStatusDiv.style.color = color;

        // SWIPE DETECTION (only on OPEN_PALM)
        if (gesture === "OPEN_PALM") {
            const now = performance.now();
            const palmX = PALM_LANDMARKS.reduce(
                (sum, index) => sum + landmarks[index].x, 0
            ) / PALM_LANDMARKS.length;
            smoothedPalmX = smoothedPalmX === null
                ? palmX
                : smoothedPalmX + 0.5 * (palmX - smoothedPalmX);

            if (now >= swipeCooldownUntil) {
                wristHistory.push({ x: smoothedPalmX, time: now });
                while (wristHistory.length > 0 &&
                    now - wristHistory[0].time > SWIPE_MAX_DURATION) {
                    wristHistory.shift();
                }

                let swipeDirection = 0;
                for (const sample of wristHistory) {
                    const duration = now - sample.time;
                    const deltaX = smoothedPalmX - sample.x;
                    const isNextSwipe = deltaX > 0;
                    const minimumDistance = isNextSwipe
                        ? NEXT_SWIPE_MIN_DISTANCE
                        : PREVIOUS_SWIPE_MIN_DISTANCE;
                    const minimumDuration = isNextSwipe
                        ? NEXT_SWIPE_MIN_DURATION
                        : PREVIOUS_SWIPE_MIN_DURATION;
                    if (duration >= minimumDuration &&
                        Math.abs(deltaX) >= minimumDistance) {
                        swipeDirection = Math.sign(deltaX);
                        break;
                    }
                }

                if (swipeDirection !== 0) {
                    swipeCooldownUntil = now + SWIPE_COOLDOWN_MS;
                    wristHistory = [];

                    if (swipeDirection > 0) {
                        console.log("👉 SWIPE RIGHT!");
                        gestureStatusDiv.textContent = 'Swipe right';
                        gestureStatusDiv.style.borderColor = 'rgba(159, 207, 190, 0.45)';
                        gestureStatusDiv.style.color = '#a3d2bf';
                        nextSlide();
                    } else {
                        console.log("👈 SWIPE LEFT!");
                        gestureStatusDiv.textContent = 'Swipe left';
                        gestureStatusDiv.style.borderColor = 'rgba(229, 154, 145, 0.4)';
                        gestureStatusDiv.style.color = '#e59a91';
                        prevSlide();
                    }
                }
            } else {
                wristHistory = [];
            }
        } else {
            wristHistory = [];
            smoothedPalmX = null;
        }

        statusDiv.textContent = `Hand active (${handType})`;
        statusDiv.style.background = 'rgba(67, 104, 86, 0.32)';
        statusDiv.style.borderColor = 'rgba(159, 207, 190, 0.38)';

    } else {
        statusDiv.textContent = 'No hand detected';
        statusDiv.style.background = 'rgba(111, 61, 59, 0.3)';
        statusDiv.style.borderColor = 'rgba(229, 154, 145, 0.32)';
        gestureStatusDiv.textContent = 'Waiting for hand';
        gestureStatusDiv.style.borderColor = 'rgba(201, 225, 216, 0.14)';
        gestureStatusDiv.style.color = '#a4b2ac';
        isDrawing = false;
        lastX = null;
        lastY = null;
        wristHistory = [];
        smoothedPalmX = null;
    }

    requestAnimationFrame(processFrame);
}

// ============================================================
// 9. START WEBCAM + LANDMARKER
// ============================================================
let homeTransitionStarted = false;

async function startCameraAndEngine() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 320, height: 240 }
        });
        video.srcObject = stream;

        await new Promise(resolve => {
            if (video.readyState >= 2) resolve();
            else video.onloadeddata = () => resolve();
        });

        await video.play();

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        setupDrawingCanvas();

        await initHandLandmarker();

        statusDiv.textContent = 'Camera ready · Try a gesture';
        statusDiv.style.background = 'rgba(65, 91, 106, 0.32)';
        console.log('🚀 FULL Gesture Remote is LIVE!');

        goToSlide(0);

        // Start detection loop
        processFrame();

    } catch (err) {
        console.error('Camera error:', err);
        statusDiv.textContent = 'Camera access denied';
        statusDiv.style.background = 'rgba(111, 61, 59, 0.3)';
    }
}

function enterPresentationStudio() {
    if (homeTransitionStarted) return;
    homeTransitionStarted = true;
    appShell.hidden = false;
    homePage.classList.add('is-leaving');
    window.setTimeout(() => {
        homePage.hidden = true;
        startCameraAndEngine();
    }, 360);
}

document.getElementById('startPresentationBtn').addEventListener('click', enterPresentationStudio);

homePage.addEventListener('pointermove', (event) => {
    homePage.style.setProperty('--pointer-x', `${event.clientX}px`);
    homePage.style.setProperty('--pointer-y', `${event.clientY}px`);
});

let draggedObject = null;
let dragStartX = 0;
let dragStartY = 0;
let objectStartLeft = 0;
let objectStartTop = 0;
let movedObject = false;

function selectSceneObject(object) {
    homeScene.querySelectorAll('.orbit-object').forEach(item => {
        item.classList.toggle('is-selected', item === object);
    });
    sceneMessage.textContent = object.dataset.description;
}

homeScene.querySelectorAll('.orbit-object').forEach(object => {
    object.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        draggedObject = object;
        movedObject = false;
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        objectStartLeft = object.offsetLeft;
        objectStartTop = object.offsetTop;
        object.style.right = 'auto';
        object.style.bottom = 'auto';
        object.style.left = `${objectStartLeft}px`;
        object.style.top = `${objectStartTop}px`;
        object.setPointerCapture(event.pointerId);
        event.preventDefault();
    });

    object.addEventListener('pointermove', (event) => {
        if (draggedObject !== object) return;
        const sceneRect = homeScene.getBoundingClientRect();
        const nextLeft = objectStartLeft + event.clientX - dragStartX;
        const nextTop = objectStartTop + event.clientY - dragStartY;
        const maxLeft = sceneRect.width - object.offsetWidth - 12;
        const maxTop = sceneRect.height - object.offsetHeight - 48;
        object.style.left = `${Math.min(Math.max(12, nextLeft), maxLeft)}px`;
        object.style.top = `${Math.min(Math.max(12, nextTop), maxTop)}px`;
        movedObject = movedObject ||
            Math.abs(event.clientX - dragStartX) + Math.abs(event.clientY - dragStartY) > 6;
    });

    object.addEventListener('pointerup', () => {
        if (draggedObject !== object) return;
        if (!movedObject) selectSceneObject(object);
        draggedObject = null;
    });

    object.addEventListener('pointercancel', () => {
        draggedObject = null;
    });

    object.addEventListener('keydown', (event) => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
            event.preventDefault();
            const step = event.shiftKey ? 24 : 12;
            const sceneRect = homeScene.getBoundingClientRect();
            let left = object.offsetLeft;
            let top = object.offsetTop;
            if (event.key === 'ArrowLeft') left -= step;
            if (event.key === 'ArrowRight') left += step;
            if (event.key === 'ArrowUp') top -= step;
            if (event.key === 'ArrowDown') top += step;
            object.style.right = 'auto';
            object.style.bottom = 'auto';
            object.style.left = `${Math.min(Math.max(12, left), sceneRect.width - object.offsetWidth - 12)}px`;
            object.style.top = `${Math.min(Math.max(12, top), sceneRect.height - object.offsetHeight - 48)}px`;
            selectSceneObject(object);
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectSceneObject(object);
        }
    });
});

document.getElementById('shuffleSceneBtn').addEventListener('click', () => {
    const positions = [
        { left: '7%', top: '8%' },
        { left: '68%', top: '9%' },
        { left: '68%', top: '64%' },
        { left: '7%', top: '64%' }
    ];
    homeScene.querySelectorAll('.orbit-object').forEach((object, index) => {
        object.style.right = 'auto';
        object.style.bottom = 'auto';
        object.style.left = positions[index].left;
        object.style.top = positions[index].top;
        object.classList.remove('is-selected');
    });
    sceneMessage.textContent = 'Scene modules repositioned';
});

// ============================================================
// 10. KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', (event) => {
    if (!homePage.hidden) return;
    if (event.key === 'ArrowLeft') {
        event.preventDefault();
        prevSlide();
        console.log('⌨️ Left Arrow: Previous Slide');
    } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        nextSlide();
        console.log('⌨️ Right Arrow: Next Slide');
    }
});

// ============================================================
// 11. PDF.JS WORKER (LOCAL PATH)
// ============================================================
pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdfjs/build/pdf.worker.min.js';

// ============================================================
// 12. SLIDE UPLOAD FEATURE
// ============================================================
const uploadBtn = document.getElementById('uploadBtn');
const slideUpload = document.getElementById('slideUpload');
const slideshowContainer = document.querySelector('.slideshow-container');

uploadBtn.addEventListener('click', () => {
    slideUpload.click();
});

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}`));
        reader.readAsDataURL(file);
    });
}

function createUploadedSlide(imageUrl) {
    const slide = document.createElement('div');
    slide.className = 'slide uploaded-slide';
    const image = document.createElement('img');
    image.className = 'uploaded-slide-image';
    image.src = imageUrl;
    image.alt = '';
    image.draggable = false;
    slide.appendChild(image);

    const number = document.createElement('div');
    number.className = 'slide-number';
    slide.appendChild(number);
    return slide;
}

async function loadSlidesFromImages(files) {
    const slides = [];
    for (const file of files) {
        const imageUrl = await readFileAsDataURL(file);
        slides.push(createUploadedSlide(imageUrl));
    }
    return slides;
}

async function loadSlidesFromPDF(file) {
    const pdfData = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    const slides = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.5 });
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = viewport.width;
        pageCanvas.height = viewport.height;
        const context = pageCanvas.getContext('2d');
        if (!context) {
            throw new Error(`Could not render PDF page ${pageNum}`);
        }

        await page.render({ canvasContext: context, viewport }).promise;
        slides.push(createUploadedSlide(pageCanvas.toDataURL('image/png')));
    }
    return slides;
}

function finalizeSlides() {
    console.log("✅ All slides loaded, updating navigation...");

    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    goToSlide(0);

    console.log(`✅ First slide is now active. Total: ${window.totalSlides}`);

    statusDiv.textContent = `${window.totalSlides} slides loaded`;
    statusDiv.style.background = 'rgba(67, 104, 86, 0.32)';
    statusDiv.style.borderColor = 'rgba(159, 207, 190, 0.38)';
}

slideUpload.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files);

    if (files.length === 0) {
        console.log("❌ No files selected");
        return;
    }

    console.log(`📤 Uploading ${files.length} files...`);
    const uploadedSlides = [];

    try {
        for (const file of files) {
            if (file.type === 'application/pdf') {
                uploadedSlides.push(...await loadSlidesFromPDF(file));
            } else if (file.type.startsWith('image/')) {
                uploadedSlides.push(...await loadSlidesFromImages([file]));
            } else {
                console.warn(`⚠️ Unsupported file type: ${file.type}`);
            }
        }

        if (uploadedSlides.length === 0) {
            statusDiv.textContent = 'No supported image or PDF files selected';
            statusDiv.style.background = 'rgba(111, 61, 59, 0.3)';
            return;
        }

        document.querySelectorAll('.slide').forEach(slide => slide.remove());
        uploadedSlides.forEach(slide => slideshowContainer.insertBefore(slide, drawCanvas));
        finalizeSlides();
    } catch (err) {
        console.error("❌ Error loading slides:", err);
        statusDiv.textContent = 'Error loading slides. Existing presentation was kept.';
        statusDiv.style.background = 'rgba(111, 61, 59, 0.3)';
    } finally {
        slideUpload.value = '';
    }
});

// ============================================================
// 13. PRESENTATION MODE
// ============================================================
const presentBtn = document.getElementById('presentBtn');
const mainTitle = document.querySelector('h1');
const cameraPip = document.querySelector('.camera-pip');
const gestureStatus = document.getElementById('gesture-status');
const statusBar = document.getElementById('status');
const hintText = document.querySelector('.hint');
const slideCounter = document.getElementById('slideCounter');
const presentBtnElement = document.getElementById('presentBtn');

let isPresentationMode = false;

presentBtn.addEventListener('click', togglePresentationMode);

document.addEventListener('keydown', (event) => {
    if (!homePage.hidden) return;
    if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        togglePresentationMode();
    }
    if (event.key === 'Escape' && isPresentationMode) {
        togglePresentationMode();
    }
});

function togglePresentationMode() {
    isPresentationMode = !isPresentationMode;

    if (isPresentationMode) {
        if (mainTitle) mainTitle.style.display = 'none';
        if (cameraPip) cameraPip.style.display = 'none';
        if (gestureStatus) gestureStatus.style.display = 'none';
        if (statusBar) statusBar.style.display = 'none';
        if (hintText) hintText.style.display = 'none';
        if (slideCounter) slideCounter.style.display = 'none';

        presentBtnElement.textContent = 'Exit presentation';
        presentBtnElement.style.background = 'var(--accent-hover)';

        if (slideshowContainer) {
            slideshowContainer.style.position = 'fixed';
            slideshowContainer.style.top = '0';
            slideshowContainer.style.left = '0';
            slideshowContainer.style.width = '100vw';
            slideshowContainer.style.height = '100vh';
            slideshowContainer.style.borderRadius = '0';
            slideshowContainer.style.border = 'none';
            slideshowContainer.style.zIndex = '9998';
            slideshowContainer.style.boxShadow = 'none';
        }

        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(err => {
                console.log('Fullscreen error:', err);
            });
        }

        console.log('🎯 Presentation Mode ON');

    } else {
        if (mainTitle) mainTitle.style.display = 'block';
        if (cameraPip) cameraPip.style.display = 'block';
        if (gestureStatus) gestureStatus.style.display = 'block';
        if (statusBar) statusBar.style.display = 'block';
        if (hintText) hintText.style.display = 'block';
        if (slideCounter) slideCounter.style.display = 'block';

        presentBtnElement.textContent = 'Present';
        presentBtnElement.style.background = 'var(--accent)';

        if (slideshowContainer) {
            slideshowContainer.style.position = 'relative';
            slideshowContainer.style.top = 'auto';
            slideshowContainer.style.left = 'auto';
            slideshowContainer.style.width = 'min(100%, 960px)';
            slideshowContainer.style.height = 'auto';
            slideshowContainer.style.aspectRatio = '16 / 9';
            slideshowContainer.style.borderRadius = '18px';
            slideshowContainer.style.border = '1px solid var(--line)';
            slideshowContainer.style.zIndex = '1';
            slideshowContainer.style.boxShadow = 'var(--shadow)';
        }

        if (document.exitFullscreen) {
            document.exitFullscreen().catch(err => {
                console.log('Exit fullscreen error:', err);
            });
        }

        console.log('🎯 Presentation Mode OFF');
    }
    requestAnimationFrame(setupDrawingCanvas);
}

document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && isPresentationMode) {
        isPresentationMode = false;
        if (mainTitle) mainTitle.style.display = 'block';
        if (cameraPip) cameraPip.style.display = 'block';
        if (gestureStatus) gestureStatus.style.display = 'block';
        if (statusBar) statusBar.style.display = 'block';
        if (hintText) hintText.style.display = 'block';
        if (slideCounter) slideCounter.style.display = 'block';

        presentBtnElement.textContent = 'Present';
        presentBtnElement.style.background = 'var(--accent)';

        if (slideshowContainer) {
            slideshowContainer.style.position = 'relative';
            slideshowContainer.style.top = 'auto';
            slideshowContainer.style.left = 'auto';
            slideshowContainer.style.width = 'min(100%, 960px)';
            slideshowContainer.style.height = 'auto';
            slideshowContainer.style.aspectRatio = '16 / 9';
            slideshowContainer.style.borderRadius = '18px';
            slideshowContainer.style.border = '1px solid var(--line)';
            slideshowContainer.style.zIndex = '1';
            slideshowContainer.style.boxShadow = 'var(--shadow)';
        }
        requestAnimationFrame(setupDrawingCanvas);
    }
});

console.log("✅ All systems ready!")
// ============================================================
// SERVICE WORKER REGISTRATION (for offline PWA)
// ============================================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then((registration) => {
                console.log('✅ Service Worker registered:', registration.scope);
            })
            .catch((error) => {
                console.log('❌ Service Worker registration failed:', error);
            });
    });
}
