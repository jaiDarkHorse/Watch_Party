const video = document.getElementById("video");
const status = document.getElementById("status");

const socket = new WebSocket("ws://localhost:8080/ws");

socket.binaryType = "arraybuffer";


let videoStreamingComplete = false;
let audioStreamingComplete = false;
let mediaSourceEnded = false;

let isHost = false;

let mediaSource = null;

let videoBuffer = null;
let audioBuffer = null;

let playbackUnlocked = false;

let syncTimer = null;

let lastSyncTime = 0;


const playButton = document.getElementById("playButton");
const pauseButton = document.getElementById("pauseButton");
const inspectButton = document.getElementById("inspectTimeline");
const enablePlaybackButton = document.getElementById("enablePlayback");


const videoMime = 'video/mp4; codecs="avc1.4D401E"';
const audioMime = 'audio/mp4; codecs="mp4a.40.2"';


const mediaQueue = [];

let waitingForBinary = null;

let processingQueue = false;

let timelineInspected = false;

let lastVideoAcknowledged = -1;

let lastAudioAcknowledged = -1;


console.log("Video supported:", MediaSource.isTypeSupported(videoMime));
console.log("Audio supported:", MediaSource.isTypeSupported(audioMime));


mediaSource = new MediaSource();

video.src = URL.createObjectURL(mediaSource);


// =========================================================
// INSPECT TIMELINE
// =========================================================

if (inspectButton)
{
    inspectButton.onclick = () =>
    {
        inspectMediaTimeline();
    };
}


// =========================================================
// VIEWER PLAYBACK UNLOCK
// =========================================================

if (enablePlaybackButton)
{
    enablePlaybackButton.onclick = async () =>
    {
        console.log("Viewer requested playback unlock.");

        try
        {
            await video.play();

            video.pause();

            playbackUnlocked = true;

            console.log("Viewer playback unlocked.");

            enablePlaybackButton.innerText = "Playback Enabled";

            enablePlaybackButton.disabled = true;
        }
        catch (error)
        {
            console.error("Failed to unlock playback:", error);
        }
    };
}


// =========================================================
// HOST PLAY
// =========================================================

if (playButton)
{
    playButton.onclick = async () =>
    {
        if (!isHost)
        {
            return;
        }

        const currentTime = video.currentTime;

        console.log("HOST PLAY");

        console.log("Host currentTime:", currentTime);

        try
        {
            await video.play();

            console.log("Host playback started.");

            startHostSync();

            if (socket.readyState === WebSocket.OPEN)
            {
                socket.send("PLAY:" + currentTime);

                console.log("Sent synchronized PLAY:", currentTime);
            }
        }
        catch (error)
        {
            console.error("Host play failed:", error);
        }
    };
}


// =========================================================
// HOST PAUSE
// =========================================================

if (pauseButton)
{
    pauseButton.onclick = () =>
    {
        if (!isHost)
        {
            return;
        }

        console.log("HOST PAUSE");

        video.pause();

        stopHostSync();

        if (socket.readyState === WebSocket.OPEN)
        {
            socket.send("PAUSE");

            console.log("Sent PAUSE to Viewer");
        }
    };
}


// =========================================================
// VIDEO EVENTS
// =========================================================

video.addEventListener("loadedmetadata", () =>
{
    console.log("loadedmetadata");

    console.log("Duration:", video.duration);
});


video.addEventListener("durationchange", () =>
{
    console.log("durationchange");

    console.log("Duration:", video.duration);
});


video.addEventListener("canplay", () =>
{
    console.log("canplay");
});


video.addEventListener("play", () =>
{
    console.log("VIDEO PLAY EVENT");

    console.log("Current time:", video.currentTime);
});


video.addEventListener("playing", () =>
{
    console.log("VIDEO PLAYING");

    console.log("Current time:", video.currentTime);
});


video.addEventListener("pause", () =>
{
    console.log("VIDEO PAUSE EVENT");

    console.log("Current time:", video.currentTime);
});


video.addEventListener("waiting", () =>
{
    console.log("VIDEO WAITING");

    console.log("Current time:", video.currentTime);
});


video.addEventListener("ended", () =>
{
    console.log("VIDEO ENDED");

    console.log("Final time:", video.currentTime);

    if (isHost)
    {
        stopHostSync();
    }
});


video.addEventListener("error", () =>
{
    console.error("VIDEO ERROR:", video.error);
});


// =========================================================
// HOST SEEK
// =========================================================

video.addEventListener("seeked", () =>
{
    if (!isHost)
    {
        return;
    }

    const currentTime = video.currentTime;

    console.log("HOST SEEKED:", currentTime);

    if (socket.readyState !== WebSocket.OPEN)
    {
        console.error("WebSocket is not open. Cannot send SEEK.");

        return;
    }

    socket.send("SEEK:" + currentTime);

    console.log("Sent SEEK:", currentTime);
});


// =========================================================
// MEDIASOURCE
// =========================================================

mediaSource.addEventListener("sourceopen", () =>
{
    console.log("MediaSource opened");

    if (!MediaSource.isTypeSupported(videoMime))
    {
        console.error("Video codec not supported");

        return;
    }

    videoBuffer = mediaSource.addSourceBuffer(videoMime);

    console.log("Video SourceBuffer created");

    if (!MediaSource.isTypeSupported(audioMime))
    {
        console.error("Audio codec not supported");

        return;
    }

    audioBuffer = mediaSource.addSourceBuffer(audioMime);

    console.log("Audio SourceBuffer created");

    status.innerText = "Video + Audio MSE ready";
});


// =========================================================
// WEBSOCKET OPEN
// =========================================================

socket.onopen = () =>
{
    console.log("WebSocket connected");

    const params = new URLSearchParams(window.location.search);

    const role = params.get("role");

    console.log("Role:", role);

    if (role === "host")
    {
        isHost = true;

        socket.send("HOST");

        return;
    }

    if (role === "viewer")
    {
        isHost = false;

        socket.send("VIEWER");

        return;
    }

    console.error("Role must be host or viewer");
};


// =========================================================
// WEBSOCKET MESSAGE
// =========================================================

socket.onmessage = async (event) =>
{
    if (typeof event.data === "string")
    {
        console.log("Received TEXT:", event.data);

        if (isHost)
        {
            await handleHostMessage(event.data);

            return;
        }

        await handleViewerTextMessage(event.data);

        return;
    }

    if (event.data instanceof ArrayBuffer)
    {
        console.log("Received BINARY:", event.data.byteLength, "bytes");

        if (isHost)
        {
            return;
        }

        handleViewerBinaryMessage(event.data);

        return;
    }
};


// =========================================================
// HOST MESSAGE HANDLER
// =========================================================

async function handleHostMessage(message)
{
    if (message === "VIEWER_READY")
    {
        console.log("Viewer is ready");

        await sendInitialization();

        await sendAudioInitialization();

        return;
    }

    if (message === "VIDEO_READY:init")
    {
        console.log("Viewer successfully processed video initialization.");

        await sendVideoSegment(1);

        return;
    }

    if (message.startsWith("VIDEO_READY:"))
    {
        const value = message.split(":")[1];

        if (value === "init")
        {
            return;
        }

        const completedSegment = Number(value);

        console.log("Viewer successfully processed video segment:", completedSegment);

        const nextSegment = completedSegment + 1;

        if (nextSegment > 9)
        {
            console.log("All video segments sent.");

            console.log("SEQUENTIAL VIDEO STREAM COMPLETE.");

            videoStreamingComplete = true;

            socket.send("VIDEO_STREAM_COMPLETE");

            tryEndMediaSource();

            return;
        }

        console.log("Preparing next video segment:", nextSegment);

        await sendVideoSegment(nextSegment);

        return;
    }

    if (message === "AUDIO_READY:init")
    {
        console.log("Viewer successfully processed audio initialization.");

        await sendAudioSegment(1);

        return;
    }

    if (message.startsWith("AUDIO_READY:"))
    {
        const value = message.split(":")[1];

        if (value === "init")
        {
            return;
        }

        const completedSegment = Number(value);

        console.log("Viewer successfully processed audio segment:", completedSegment);

        const nextSegment = completedSegment + 1;

        if (nextSegment > 32)
        {
            console.log("All audio segments sent.");

            console.log("SEQUENTIAL AUDIO STREAM COMPLETE.");

            audioStreamingComplete = true;

            socket.send("AUDIO_STREAM_COMPLETE");

            tryEndMediaSource();

            return;
        }

        console.log("Preparing next audio segment:", nextSegment);

        await sendAudioSegment(nextSegment);

        return;
    }
}


// =========================================================
// VIEWER TEXT HANDLER
// =========================================================

async function handleViewerTextMessage(message)
{
    if (message === "VIDEO_STREAM_COMPLETE")
    {
        console.log("Host reports video stream complete.");

        videoStreamingComplete = true;

        tryEndMediaSource();

        return;
    }

    if (message === "AUDIO_STREAM_COMPLETE")
    {
        console.log("Host reports audio stream complete.");

        audioStreamingComplete = true;

        tryEndMediaSource();

        return;
    }

    if (message === "VIEWER_REGISTERED")
    {
        console.log("Viewer registered");

        return;
    }

    // =====================================================
    // SYNCHRONIZED PLAY
    // =====================================================

    if (message.startsWith("PLAY:"))
    {
        console.log("Received synchronized PLAY from HOST:", message);

        if (!playbackUnlocked)
        {
            console.log("Viewer playback is not unlocked yet.");

            return;
        }

        const value = message.split(":")[1];

        const hostTime = Number(value);

        if (Number.isNaN(hostTime))
        {
            console.error("Invalid PLAY timestamp:", value);

            return;
        }

        console.log("Host playback position:", hostTime);

        if (video.readyState < 2)
        {
            console.log("Viewer is not ready to play yet.");

            return;
        }

        try
        {
            video.currentTime = hostTime;

            console.log("Viewer currentTime synchronized:", video.currentTime);

            await video.play();

            console.log("Viewer playback started.");
        }
        catch (error)
        {
            console.error("Viewer synchronized PLAY failed:", error);
        }

        return;
    }

    // =====================================================
    // PAUSE
    // =====================================================

    if (message === "PAUSE")
    {
        console.log("Received PAUSE from HOST");

        video.pause();

        console.log("Viewer playback paused");

        return;
    }

    // =====================================================
    // SEEK
    // =====================================================

    if (message.startsWith("SEEK:"))
    {
        console.log("Received SEEK from HOST:", message);

        const value = message.split(":")[1];

        const hostTime = Number(value);

        if (Number.isNaN(hostTime))
        {
            console.error("Invalid SEEK timestamp:", value);

            return;
        }

        console.log("Seeking Viewer to:", hostTime);

        if (video.readyState < 1)
        {
            console.log("Viewer video is not ready for seeking.");

            return;
        }

        try
        {
            video.currentTime = hostTime;

            console.log("Viewer seek completed.");

            console.log("Viewer currentTime:", video.currentTime);
        }
        catch (error)
        {
            console.error("Viewer seek failed:", error);
        }

        return;
    }

    // =====================================================
    // DRIFT SYNCHRONIZATION
    // =====================================================

    if (message.startsWith("SYNC:"))
    {
        console.log("Received SYNC from HOST:", message);

        const value = message.split(":")[1];

        const hostTime = Number(value);

        if (Number.isNaN(hostTime))
        {
            console.error("Invalid SYNC timestamp:", value);

            return;
        }

        const viewerTime = video.currentTime;

        const drift = hostTime - viewerTime;

        console.log("Host time:", hostTime);

        console.log("Viewer time:", viewerTime);

        console.log("Playback drift:", drift, "seconds");

        if (drift > 0)
        {
            console.log("Viewer is behind Host by:", drift, "seconds");
        }
        else if (drift < 0)
        {
            console.log("Viewer is ahead of Host by:", Math.abs(drift), "seconds");
        }
        else
        {
            console.log("Viewer and Host are synchronized.");
        }

        return;
    }

    // =====================================================
    // VIDEO INITIALIZATION
    // =====================================================

    if (message === "VIDEO_SEGMENT:init")
    {
        console.log("Queued VIDEO initialization descriptor");

        waitingForBinary =
        {
            type: "video",
            segment: "init"
        };

        return;
    }

    // =====================================================
    // VIDEO SEGMENT
    // =====================================================

    if (message.startsWith("VIDEO_SEGMENT:"))
    {
        const value = message.split(":")[1];

        const segmentNumber = Number(value);

        console.log("Queued VIDEO segment descriptor:", segmentNumber);

        waitingForBinary =
        {
            type: "video",
            segment: segmentNumber
        };

        return;
    }

    // =====================================================
    // AUDIO INITIALIZATION
    // =====================================================

    if (message === "AUDIO_SEGMENT:init")
    {
        console.log("Queued AUDIO initialization descriptor");

        waitingForBinary =
        {
            type: "audio",
            segment: "init"
        };

        return;
    }

    // =====================================================
    // AUDIO SEGMENT
    // =====================================================

    if (message.startsWith("AUDIO_SEGMENT:"))
    {
        const value = message.split(":")[1];

        const segmentNumber = Number(value);

        console.log("Queued AUDIO segment descriptor:", segmentNumber);

        waitingForBinary =
        {
            type: "audio",
            segment: segmentNumber
        };

        return;
    }
}


// =========================================================
// VIEWER BINARY HANDLER
// =========================================================

function handleViewerBinaryMessage(data)
{
    if (!waitingForBinary)
    {
        console.error("Received binary data without a media descriptor.");

        return;
    }

    const mediaItem =
    {
        type: waitingForBinary.type,
        segment: waitingForBinary.segment,
        data: data
    };

    console.log("Paired binary data:", mediaItem.type, mediaItem.segment, data.byteLength, "bytes");

    waitingForBinary = null;

    mediaQueue.push(mediaItem);

    console.log("Media queue length:", mediaQueue.length);

    processMediaQueue();
}


// =========================================================
// MEDIA QUEUE
// =========================================================

async function processMediaQueue()
{
    if (processingQueue)
    {
        return;
    }

    processingQueue = true;

    try
    {
        while (mediaQueue.length > 0)
        {
            const item = mediaQueue.shift();

            console.log("Processing:", item.type, item.segment);

            if (item.type === "video")
            {
                await processVideoItem(item);
            }
            else if (item.type === "audio")
            {
                await processAudioItem(item);
            }
        }
    }
    catch (error)
    {
        console.error("Media queue processing error:", error);
    }

    processingQueue = false;

    if (mediaQueue.length === 0 && !timelineInspected)
    {
        timelineInspected = true;

        setTimeout(() =>
        {
            inspectMediaTimeline();
        }, 1000);
    }
}


// =========================================================
// PROCESS VIDEO
// =========================================================

async function processVideoItem(item)
{
    console.log("Appending VIDEO:", item.segment);

    await appendToVideoBuffer(item.data, item.segment);

    sendVideoAcknowledgement(item.segment);
}


// =========================================================
// PROCESS AUDIO
// =========================================================

async function processAudioItem(item)
{
    console.log("Appending AUDIO:", item.segment);

    await appendToAudioBuffer(item.data, item.segment);

    sendAudioAcknowledgement(item.segment);
}


// =========================================================
// VIDEO ACKNOWLEDGEMENT
// =========================================================

function sendVideoAcknowledgement(segment)
{
    if (segment === "init")
    {
        socket.send("VIDEO_READY:init");

        console.log("Sent video acknowledgement:", "VIDEO_READY:init");

        return;
    }

    const number = Number(segment);

    if (number <= lastVideoAcknowledged)
    {
        console.log("Duplicate video acknowledgement ignored:", number);

        return;
    }

    lastVideoAcknowledged = number;

    socket.send("VIDEO_READY:" + number);

    console.log("Sent video acknowledgement:", "VIDEO_READY:" + number);
}


// =========================================================
// AUDIO ACKNOWLEDGEMENT
// =========================================================

function sendAudioAcknowledgement(segment)
{
    if (segment === "init")
    {
        socket.send("AUDIO_READY:init");

        console.log("Sent audio acknowledgement:", "AUDIO_READY:init");

        return;
    }

    const number = Number(segment);

    if (number <= lastAudioAcknowledged)
    {
        console.log("Duplicate audio acknowledgement ignored:", number);

        return;
    }

    lastAudioAcknowledged = number;

    socket.send("AUDIO_READY:" + number);

    console.log("Sent audio acknowledgement:", "AUDIO_READY:" + number);
}


// =========================================================
// SEND VIDEO INITIALIZATION
// =========================================================

async function sendInitialization()
{
    const path = "/segments/init-stream0.m4s";

    console.log("Loading:", path);

    const response = await fetch(path);

    if (!response.ok)
    {
        console.error("Failed to load:", path, response.status);

        return;
    }

    const data = await response.arrayBuffer();

    console.log("Loaded video initialization:", data.byteLength, "bytes");

    await appendToVideoBuffer(data, "init");

    console.log("Host video initialization appended.");

    socket.send("VIDEO_SEGMENT:init");

    socket.send(data);

    console.log("Video initialization descriptor + binary sent.");
}


// =========================================================
// SEND AUDIO INITIALIZATION
// =========================================================

async function sendAudioInitialization()
{
    const path = "/segments/init-stream1.m4s";

    console.log("Loading audio initialization:", path);

    const response = await fetch(path);

    if (!response.ok)
    {
        console.error("Failed to load audio initialization:", response.status);

        return;
    }

    const data = await response.arrayBuffer();

    console.log("Loaded audio initialization:", data.byteLength, "bytes");

    await appendToAudioBuffer(data, "init");

    console.log("Host audio initialization appended.");

    socket.send("AUDIO_SEGMENT:init");

    socket.send(data);

    console.log("Audio initialization descriptor + binary sent.");
}


// =========================================================
// SEND VIDEO SEGMENT
// =========================================================

async function sendVideoSegment(segmentNumber)
{
    const filename = "chunk-stream0-" + String(segmentNumber).padStart(5, "0") + ".m4s";

    const path = "/segments/" + filename;

    console.log("Loading video segment:", segmentNumber);

    console.log("Path:", path);

    const response = await fetch(path);

    if (!response.ok)
    {
        console.error("Failed to load video segment:", path, response.status);

        return;
    }

    const data = await response.arrayBuffer();

    console.log("Loaded video segment:", segmentNumber, data.byteLength, "bytes");

    await appendToVideoBuffer(data, segmentNumber);

    console.log("Host video segment appended:", segmentNumber);

    socket.send("VIDEO_SEGMENT:" + segmentNumber);

    socket.send(data);

    console.log("Video descriptor + binary sent:", segmentNumber);
}


// =========================================================
// SEND AUDIO SEGMENT
// =========================================================

async function sendAudioSegment(segmentNumber)
{
    const filename = "chunk-stream1-" + String(segmentNumber).padStart(5, "0") + ".m4s";

    const path = "/segments/" + filename;

    console.log("Loading audio segment:", segmentNumber);

    console.log("Path:", path);

    const response = await fetch(path);

    if (!response.ok)
    {
        console.error("Failed to load audio segment:", path, response.status);

        return;
    }

    const data = await response.arrayBuffer();

    console.log("Loaded audio segment:", segmentNumber, data.byteLength, "bytes");

    await appendToAudioBuffer(data, segmentNumber);

    console.log("Host audio segment appended:", segmentNumber);

    socket.send("AUDIO_SEGMENT:" + segmentNumber);

    socket.send(data);

    console.log("Audio descriptor + binary sent:", segmentNumber);
}


// =========================================================
// VIDEO MSE APPEND
// =========================================================

function appendToVideoBuffer(data, segmentName)
{
    return new Promise((resolve, reject) =>
    {
        if (!videoBuffer)
        {
            reject(new Error("Video SourceBuffer is not ready"));

            return;
        }

        const append = () =>
        {
            if (videoBuffer.updating)
            {
                console.log("Video SourceBuffer busy. Waiting...");

                videoBuffer.addEventListener("updateend", append, { once: true });

                return;
            }

            const onUpdateEnd = () =>
            {
                cleanup();

                console.log("Video MSE append completed:", segmentName);

                resolve();
            };

            const onError = () =>
            {
                cleanup();

                console.error("Video MSE append failed:", segmentName);

                reject(new Error("Video MSE append failed"));
            };

            function cleanup()
            {
                videoBuffer.removeEventListener("updateend", onUpdateEnd);

                videoBuffer.removeEventListener("error", onError);
            }

            videoBuffer.addEventListener("updateend", onUpdateEnd, { once: true });

            videoBuffer.addEventListener("error", onError, { once: true });

            console.log("Calling video appendBuffer:", segmentName);

            try
            {
                videoBuffer.appendBuffer(data);
            }
            catch (error)
            {
                cleanup();

                console.error("Video appendBuffer error:", error);

                reject(error);
            }
        };

        append();
    });
}


// =========================================================
// AUDIO MSE APPEND
// =========================================================

function appendToAudioBuffer(data, segmentName)
{
    return new Promise((resolve, reject) =>
    {
        if (!audioBuffer)
        {
            reject(new Error("Audio SourceBuffer is not ready"));

            return;
        }

        const append = () =>
        {
            if (audioBuffer.updating)
            {
                console.log("Audio SourceBuffer busy. Waiting...");

                audioBuffer.addEventListener("updateend", append, { once: true });

                return;
            }

            const onUpdateEnd = () =>
            {
                cleanup();

                console.log("Audio MSE append completed:", segmentName);

                resolve();
            };

            const onError = () =>
            {
                cleanup();

                console.error("Audio MSE append failed:", segmentName);

                reject(new Error("Audio MSE append failed"));
            };

            function cleanup()
            {
                audioBuffer.removeEventListener("updateend", onUpdateEnd);

                audioBuffer.removeEventListener("error", onError);
            }

            audioBuffer.addEventListener("updateend", onUpdateEnd, { once: true });

            audioBuffer.addEventListener("error", onError, { once: true });

            console.log("Calling audio appendBuffer:", segmentName);

            try
            {
                audioBuffer.appendBuffer(data);
            }
            catch (error)
            {
                cleanup();

                console.error("Audio appendBuffer error:", error);

                reject(error);
            }
        };

        append();
    });
}


// =========================================================
// HOST SYNC TIMER
// =========================================================

function startHostSync()
{
    if (!isHost)
    {
        return;
    }

    if (syncTimer !== null)
    {
        return;
    }

    console.log("Starting Host synchronization timer.");

    syncTimer = setInterval(() =>
    {
        if (socket.readyState !== WebSocket.OPEN)
        {
            return;
        }

        if (video.paused)
        {
            return;
        }

        if (video.ended)
        {
            return;
        }

        const currentTime = video.currentTime;

        lastSyncTime = currentTime;

        socket.send("SYNC:" + currentTime);

        console.log("SYNC sent:", currentTime);
    }, 2000);
}


// =========================================================
// STOP HOST SYNC
// =========================================================

function stopHostSync()
{
    if (syncTimer === null)
    {
        return;
    }

    clearInterval(syncTimer);

    syncTimer = null;

    console.log("Host synchronization timer stopped.");
}


// =========================================================
// END MEDIASOURCE
// =========================================================

function tryEndMediaSource()
{
    if (mediaSourceEnded)
    {
        return;
    }

    if (!videoStreamingComplete)
    {
        return;
    }

    if (!audioStreamingComplete)
    {
        return;
    }

    if (videoBuffer.updating)
    {
        console.log("Waiting for video SourceBuffer to finish.");

        return;
    }

    if (audioBuffer.updating)
    {
        console.log("Waiting for audio SourceBuffer to finish.");

        return;
    }

    if (mediaSource.readyState !== "open")
    {
        console.log("MediaSource is not open.");

        return;
    }

    mediaSource.endOfStream();

    mediaSourceEnded = true;

    console.log("MediaSource ended.");

    console.log("Final duration:", video.duration);

    setTimeout(() =>
    {
        inspectMediaTimeline();
    }, 100);
}


// =========================================================
// TIMELINE INSPECTION
// =========================================================

function inspectMediaTimeline()
{
    console.log("========== MEDIA TIMELINE ==========");

    console.log("Is Host:", isHost);

    console.log("MediaSource readyState:", mediaSource.readyState);

    console.log("Video duration:", video.duration);

    console.log("Video currentTime:", video.currentTime);

    console.log("Video readyState:", video.readyState);

    console.log("Video networkState:", video.networkState);

    console.log("Video error:", video.error);

    console.log("Video paused:", video.paused);

    console.log("Video ended:", video.ended);

    if (videoBuffer)
    {
        console.log("Video SourceBuffer updating:", videoBuffer.updating);

        console.log("Video buffered ranges:", videoBuffer.buffered.length);

        for (let i = 0; i < videoBuffer.buffered.length; i++)
        {
            console.log("Video buffered:", videoBuffer.buffered.start(i), "→", videoBuffer.buffered.end(i));
        }
    }

    if (audioBuffer)
    {
        console.log("Audio SourceBuffer updating:", audioBuffer.updating);

        console.log("Audio buffered ranges:", audioBuffer.buffered.length);

        for (let i = 0; i < audioBuffer.buffered.length; i++)
        {
            console.log("Audio buffered:", audioBuffer.buffered.start(i), "→", audioBuffer.buffered.end(i));
        }
    }

    console.log("Last Host SYNC time:", lastSyncTime);

    console.log("====================================");
}


// =========================================================
// WEBSOCKET ERROR
// =========================================================

socket.onerror = (error) =>
{
    console.error("WebSocket ERROR:", error);
};


// =========================================================
// WEBSOCKET CLOSE
// =========================================================

socket.onclose = (event) =>
{
    console.log("WebSocket disconnected");

    console.log("Close code:", event.code);

    console.log("Close reason:", event.reason);

    console.log("Was clean:", event.wasClean);

    stopHostSync();
};