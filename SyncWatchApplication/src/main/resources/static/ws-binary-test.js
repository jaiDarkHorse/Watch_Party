const socket = new WebSocket(
    "ws://localhost:8080/ws"
);

socket.binaryType = "arraybuffer";


let isHost = false;


socket.onopen = () => {

    console.log(
        "WebSocket connected"
    );


    const params =
        new URLSearchParams(
            window.location.search
        );

    const role =
        params.get("role");


    console.log(
        "Role:",
        role
    );


    if (role === "host") {

        isHost = true;

        socket.send("HOST");

    }

    else if (role === "viewer") {

        socket.send("VIEWER");

    }

    else {

        console.error(
            "Role must be host or viewer"
        );
    }
};


socket.onmessage = async (event) => {

    /*
     * TEXT MESSAGE
     */

    if (typeof event.data === "string") {

        console.log(
            "Received TEXT:",
            event.data
        );


        /*
         * HOST registration confirmed.
         *
         * Now send the first fMP4
         * initialization segment.
         */

		if (isHost && event.data === "VIEWER_READY") {

		    console.log(
		        "A viewer is ready."
		    );

		    console.log(
		        "Loading video initialization segment..."
		    );


		    const response =
		        await fetch(
		            "/segments/init-stream0.m4s"
		        );


		    if (!response.ok) {

		        console.error(
		            "Failed to load init segment"
		        );

		        return;
		    }


		    const data =
		        await response.arrayBuffer();


		    console.log(
		        "Loaded init segment:",
		        data.byteLength,
		        "bytes"
		    );


		    console.log(
		        "Sending binary segment to Oracle..."
		    );


		    socket.send(data);


		    console.log(
		        "Binary segment sent"
		    );
		}

        return;
    }


    /*
     * BINARY MESSAGE
     */

    if (event.data instanceof ArrayBuffer) {

        console.log(
            "Received BINARY message"
        );


        console.log(
            "Binary size:",
            event.data.byteLength,
            "bytes"
        );


        const bytes =
            new Uint8Array(
                event.data
            );


        console.log(
            "First 16 bytes:",
            Array.from(
                bytes.slice(0, 16)
            )
        );
    }
};


socket.onerror = (error) => {

    console.error(
        "WebSocket error:",
        error
    );
};


socket.onclose = () => {

    console.log(
        "WebSocket disconnected"
    );
};