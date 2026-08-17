const video = document.getElementById("video");
const status = document.getElementById("status");

const mediaSource = new MediaSource();

video.src = URL.createObjectURL(mediaSource);


const videoMime =
    'video/mp4; codecs="avc1.4D401E"';

const audioMime =
    'audio/mp4; codecs="mp4a.40.2"';


console.log(
    "Video supported:",
    MediaSource.isTypeSupported(videoMime)
);

console.log(
    "Audio supported:",
    MediaSource.isTypeSupported(audioMime)
);


mediaSource.addEventListener("sourceopen", async () => {

    console.log("MediaSource opened");

    if (!MediaSource.isTypeSupported(videoMime)) {
        console.error("Video codec not supported");
        return;
    }

    if (!MediaSource.isTypeSupported(audioMime)) {
        console.error("Audio codec not supported");
        return;
    }


    const videoBuffer =
        mediaSource.addSourceBuffer(videoMime);

    const audioBuffer =
        mediaSource.addSourceBuffer(audioMime);


    console.log("SourceBuffers created");


    try {

        /*
         * 1. Append video initialization segment
         */
        console.log("Loading video initialization...");

        const videoInit =
            await fetch(
                "/segments/init-stream0.m4s"
            ).then(response => {

                if (!response.ok) {
                    throw new Error(
                        "Failed to load video initialization"
                    );
                }

                return response.arrayBuffer();
            });


        await appendBuffer(
            videoBuffer,
            videoInit
        );

        console.log(
            "Video initialization appended"
        );


        /*
         * 2. Append audio initialization segment
         */
        console.log("Loading audio initialization...");

        const audioInit =
            await fetch(
                "/segments/init-stream1.m4s"
            ).then(response => {

                if (!response.ok) {
                    throw new Error(
                        "Failed to load audio initialization"
                    );
                }

                return response.arrayBuffer();
            });


        await appendBuffer(
            audioBuffer,
            audioInit
        );

        console.log(
            "Audio initialization appended"
        );


        /*
         * 3. Video segments
         */

        for (let i = 1; i <= 9; i++) {

            const filename =
                String(i).padStart(5, "0");

            console.log(
                `Loading video segment ${i}`
            );


            const data =
                await fetch(
                    `/segments/chunk-stream0-${filename}.m4s`
                ).then(response => {

                    if (!response.ok) {
                        throw new Error(
                            `Failed to load video segment ${i}`
                        );
                    }

                    return response.arrayBuffer();
                });


            await appendBuffer(
                videoBuffer,
                data
            );


            console.log(
                `Video segment ${i} appended`
            );
        }


        /*
         * 4. Audio segments
         */

        for (let i = 1; i <= 32; i++) {

            const filename =
                String(i).padStart(5, "0");

            console.log(
                `Loading audio segment ${i}`
            );


            const data =
                await fetch(
                    `/segments/chunk-stream1-${filename}.m4s`
                ).then(response => {

                    if (!response.ok) {
                        throw new Error(
                            `Failed to load audio segment ${i}`
                        );
                    }

                    return response.arrayBuffer();
                });


            await appendBuffer(
                audioBuffer,
                data
            );


            console.log(
                `Audio segment ${i} appended`
            );
        }


        console.log(
            "All segments appended"
        );

        status.innerText =
            "All segments loaded";


        /*
         * We are finished.
         */
        if (mediaSource.readyState === "open") {

            mediaSource.endOfStream();

        }

    } catch (error) {

        console.error(
            "SEGMENT PLAYBACK ERROR:",
            error
        );

        status.innerText =
            "Segment playback error";

    }

});


/*
 * Helper function
 *
 * SourceBuffer.appendBuffer() is asynchronous.
 *
 * Therefore we must wait for
 * "updateend" before appending
 * another buffer.
 */

function appendBuffer(
    sourceBuffer,
    data
) {

    return new Promise(
        (resolve, reject) => {

            const onUpdateEnd = () => {

                cleanup();

                resolve();

            };


            const onError = (event) => {

                cleanup();

                reject(
                    new Error(
                        "SourceBuffer append failed"
                    )
                );

            };


            function cleanup() {

                sourceBuffer.removeEventListener(
                    "updateend",
                    onUpdateEnd
                );

                sourceBuffer.removeEventListener(
                    "error",
                    onError
                );

            }


            sourceBuffer.addEventListener(
                "updateend",
                onUpdateEnd,
                { once: true }
            );


            sourceBuffer.addEventListener(
                "error",
                onError,
                { once: true }
            );


            sourceBuffer.appendBuffer(data);

        }
    );
}