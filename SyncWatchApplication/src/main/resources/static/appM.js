const video = document.getElementById("video");
const videoFile = document.getElementById("videoFile");

const hostButton = document.getElementById("hostButton");
const viewerButton = document.getElementById("viewerButton");

const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");

const status = document.getElementById("status");


let role = null;
let socket = null;
let peerConnection = null;
let localStream = null;
let viewerReady = false;


// Connect to Spring Boot WebSocket

socket = new WebSocket(
    "wss://" + window.location.host + "/ws"
);


socket.onopen = () => {

    status.innerText = "Connected to Spring Boot";

    console.log("Connected to WebSocket");

};


// Host button

hostButton.onclick = () => {

    role = "HOST";

    video.controls = true;

    socket.send(
        JSON.stringify({
            type: "HOST"
        })
    );

    status.innerText = "You are the Host";

};


// Viewer button

viewerButton.onclick = () => {

    role = "VIEWER";

    video.controls = false;

    socket.send(
        JSON.stringify({
            type: "VIEWER"
        })
    );

    status.innerText = "You are the Viewer";

    send({
        type: "VIEWER_READY"
    });

};


// Host selects video

videoFile.onchange = () => {

    if (role !== "HOST") {

        alert("Only the host can select a video");

        return;
    }


    const file = videoFile.files[0];

    if (!file) {
        return;
    }


    const url = URL.createObjectURL(file);

    video.src = url;

    video.load();

    console.log("Video selected:", file.name);

};


// Video loaded

video.onloadedmetadata = async () => {

    if (role !== "HOST") {
        return;
    }


    localStream = video.captureStream();

    console.log("Video stream captured");


    if (viewerReady) {

        await createOffer();

    }

};


// Create WebRTC connection

function createPeerConnection() {

    peerConnection = new RTCPeerConnection({

        iceServers: [
            {
                urls: "stun:stun.l.google.com:19302"
            }
        ]

    });


    peerConnection.onicecandidate = event => {

        if (event.candidate) {

            send({
                type: "ICE",
                candidate: event.candidate
            });

        }

    };

}


// Host creates offer

async function createOffer() {

    createPeerConnection();


    localStream.getTracks().forEach(track => {

        peerConnection.addTrack(
            track,
            localStream
        );

    });


    const offer = await peerConnection.createOffer();

    await peerConnection.setLocalDescription(offer);


    send({
        type: "OFFER",
        offer: offer
    });

    console.log("Offer sent");

}


// Setup viewer

function setupViewer() {

    createPeerConnection();


    peerConnection.ontrack = event => {

        console.log("Video received");

        video.srcObject = event.streams[0];

        video.play().catch(error => {

            console.log(
                "Viewer play error:",
                error
            );

        });

    };

}


// WebSocket message handling

socket.onmessage = async event => {

    const data = JSON.parse(event.data);

    console.log("Received:", data);


    // Viewer is ready

    if (data.type === "VIEWER_READY") {

        if (role === "HOST") {

            viewerReady = true;


            if (localStream) {

                await createOffer();

            }

        }

        return;
    }


    // Receive offer

    if (data.type === "OFFER") {

        if (role !== "VIEWER") {
            return;
        }


        setupViewer();


        await peerConnection.setRemoteDescription(
            data.offer
        );


        const answer =
            await peerConnection.createAnswer();


        await peerConnection.setLocalDescription(
            answer
        );


        send({
            type: "ANSWER",
            answer: answer
        });

        console.log("Answer sent");

        return;
    }


    // Receive answer

    if (data.type === "ANSWER") {

        if (role !== "HOST") {
            return;
        }


        await peerConnection.setRemoteDescription(
            data.answer
        );

        console.log("Answer received");

        return;
    }


    // Receive ICE candidate

    if (data.type === "ICE") {

        if (peerConnection) {

            try {

                await peerConnection.addIceCandidate(
                    data.candidate
                );

            } catch (error) {

                console.error(
                    "ICE error:",
                    error
                );

            }

        }

        return;
    }


    // Play video

    if (data.type === "PLAY") {

        if (role !== "VIEWER") {
            return;
        }


        video.play().catch(error => {

            console.log(
                "Viewer play error:",
                error
            );

        });

        return;
    }


    // Stop video

    if (data.type === "STOP") {

        if (role !== "VIEWER") {
            return;
        }


        video.pause();

        return;
    }

};


// Send message to Spring Boot

function send(data) {

    socket.send(
        JSON.stringify(data)
    );

}


// Host starts video

startButton.onclick = async () => {

    if (role !== "HOST") {
        return;
    }


    if (!video.src) {

        alert("Please select a video first");

        return;
    }


    await video.play();


    send({
        type: "PLAY"
    });

};


// Host stops video

stopButton.onclick = () => {

    if (role !== "HOST") {
        return;
    }


    video.pause();


    send({
        type: "STOP"
    });

};