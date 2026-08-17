const socket = new WebSocket(
    "ws://localhost:8080/ws"
);


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

	    socket.send("HOST");

	    setTimeout(() => {

	        socket.send(
	            "HELLO_FROM_HOST"
	        );

	    }, 1000);

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


socket.onmessage = (event) => {

    console.log(
        "Message from Oracle:",
        event.data
    );

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