/** @file Provides code to interact with the room page. */

/**
 * A global variable which maps ids to their corresponding threads.
 * @type {Map<number, Thread>}
 */
let threads = new Map();

/** The logical representation of a message (as opposed to HTML). */
class Message {
    /**
     * Creates a message.
     * @param {object} messageStruct A JSON object returned by the server,
     *     representing the message.
     */
    constructor(messageStruct) {
        /**
         * The id of the message.
         * @type {number}
         */
        this.id = messageStruct.id;
        /**
         * The content of the message, as an HTML string.
         * @type {string}
         */
        this.content = messageStruct.content;
        /**
         * The UNIX timestamp of the moment the message was posted, in milliseconds.
         * @type {number}
         */
        this.timestamp = messageStruct.timestamp;
        /**
         * The id of the message to which this one replies.
         * It's `null` if this message starts a new thread.
         * @type {number?}
         */
        this.replyTo = messageStruct.reply_to;
    }

    /**
     * Builds an HTML element corresponding to the message and returns it.
     * @return {HTMLElement} The HTML element.
     */
    asElement() {
        const contentElement = document.createElement('div');
        contentElement.innerHTML = this.content;
        addMentions(contentElement);

        const box = document.createElement('div');
        box.classList.add('message');
        box.innerHTML = `
            <div class="message-info">
                <p id="message${this.id}" class="message-id">#${this.id}</p>
                <p class="message-timestamp">${this.timestampHtml()}</p>
            </div>
            <div class="message-content">
                ${contentElement.innerHTML}
            </div>
        `;
        return box;
    }

    /**
     * Returns an HTML representation of the message's timestamp.
     * @return {string} The HTML string.
     */
    timestampHtml() {
        const date = new Date(this.timestamp);

        const day = date.getDate();
        const month = date.toLocaleString('en', {month: 'short'});
        const year = date.getFullYear();

        const hours = date.getHours();
        // Minutes should have leading zeros.
        const minutes = String(date.getMinutes()).padStart(2, '0');

        return `${day} ${month} ${year} @ ${hours}:${minutes}`;
    }
}

/**
 * Adds links to the messages mentioned in the given element.
 *
 * Mentions have the format: "@{messageId}".
 *
 * @param {HTMLElement} element The element to be modified (probably
 *     the element returned by a {@link Message}).
 */
const addMentions = (element) => {
    findAndReplaceDOMText(element, {
        find: /@\d+/g,
        replace: (tag) => {
            const replyId = tag.text.slice(1);
            const link = document.createElement('a');
            link.href = `#message${replyId}`;
            link.classList.add('mention');
            link.innerHTML = tag.text;
            return link;
        },
    });
};

/** The logical representation of a thread (as opposed to HTML). */
class Thread {
    /**
     * Creates a thread.
     * @param {object} messageStruct A JSON object returned by the server,
     *     representing the message which starts a thread.
     */
    constructor(messageStruct) {
        /**
         * The message which started the thread.
         * @type {Message}
         */
        this.firstMessage = new Message(messageStruct);
        /**
         * The list of replies made to the thread.
         * @type {Array<Message>}
         */
        this.replies = [];
        /**
         * The object which allows users to reply to the thread.
         * @type {Replier}
         */
        this.replier = new Replier(messageStruct.id);
    }

    /**
     * Adds the given reply to the thread.
     * @param {Message} message The reply
     */
    addReply(message) {
        this.replies.push(message);
    }

    /**
     * Builds an HTML element corresponding to the thread and returns it.
     * @return {HTMLElement} The HTML element.
     */
    asElement() {
        const replies = (() => {
            const div = document.createElement('div');
            div.classList.add('replies');

            // Replies should be displayed in chronological order.
            this.replies.sort((a, b) => a.timestamp - b.timestamp);
            for (const reply of this.replies) {
                div.appendChild(reply.asElement());
            }
            return div;
        })();
        replies.hidden = sessionStorage.getItem(this.openId()) == null;

        const replier = this.replier.asElement();
        replier.hidden = sessionStorage.getItem(this.openId()) == null;

        const threadStarter = (() => {
            const clickable = document.createElement('a');
            clickable.innerHTML = `
                <div class="thread-starter">
                    ${this.firstMessage.asElement().outerHTML}
                    <div class="thread-info">
                        <p>${this.repliesDescription()}</p>
                    </div>
                </div>
            `;

            const openId = this.openId();
            clickable.addEventListener('click', () => {
                if (replies.hidden) {
                    sessionStorage.setItem(openId, true);
                    replies.hidden = false;
                    replier.hidden = false;
                } else {
                    sessionStorage.removeItem(openId);
                    replies.hidden = true;
                    replier.hidden = true;
                }
            });
            return clickable;
        })();

        const thread = document.createElement('div');
        thread.classList.add('thread');
        thread.appendChild(threadStarter);
        thread.appendChild(replies);
        thread.appendChild(replier);
        return thread;
    }

    /**
     * Returns the key name used by storage to know if this thread is open or not.
     * @return {string} The thread's "open id".
     */
    openId() {
        return `open${this.firstMessage.id}room${roomName}`;
    }

    /**
     * Returns a human-readable description of the number of replies.
     * @return {string} The description.
     */
    repliesDescription() {
        const count = this.replies.length;
        switch (count) {
            case 0: return 'No replies';
            case 1: return '1 reply';
            default: return `${count} replies`;
        }
    }

    /**
     * Returns the timestamp of the message which started the thread.
     * @return {number} The thread's timestamp.
     */
    timestamp() {
        return this.firstMessage.timestamp;
    }
}

/** A "reply box" which allows users to reply to threads. */
class Replier {
    /**
     * Creates a {@link Replier}.
     * @param {number} threadId The id of the thread which owns the repiler.
     */
    constructor(threadId) {
        /**
         * The id of the thread to which we reply.
         * @type {number}
         */
        this.threadId = threadId;
        /**
         * The HTML element which represents the {@link Replier} on the page.
         *
         * It should be built lazily.
         *
         * @type {HTMLElement?}
         */
        this.element = null;
        /**
         * The element which allows the {@link Replier} to display messages
         * returned by the server in response to our posts.
         * @type {HTMLElement?}
         */
        this.info = null;
    }

    /**
     * Returns an HTML representation of the {@link Replier}.
     * @return {HTMLElement} The HTML element.
     */
    asElement() {
        if (this.element == null) {
            this.element = this.buildElement();
        }
        return this.element;
    }

    /**
     * Builds an HTML representation of the {@link Replier} and returns it.
     * @return {HTMLElement} The HTML element.
     */
    buildElement() {
        this.info = document.createElement('p');
        this.info.classList.add('replier-info');

        const textarea = document.createElement('textarea');
        textarea.name = 'content';
        textarea.placeholder = "Write your reply here.\nYou can use CommonMark.";
        textarea.required = true;
        makeTextareaResizable(textarea);

        const controls = document.createElement('div');
        controls.classList.add('replier-controls');
        controls.innerHTML = `
            <input type="submit" value="Send">
            <input type="reset" value="Clear">
        `;

        const form = document.createElement('form');
        form.appendChild(textarea);
        form.appendChild(controls);
        form.onsubmit = async (event) => {
            event.preventDefault();
            await this.send(form);
            await refreshMessages();
            scrollToStoredPos();
        };
        form.onreset = (event) => {
            event.preventDefault();
            const textarea = form.elements['content'];
            textarea.value = '';
            textarea.dispatchEvent(new Event('input')); // Resize the textarea.
        };

        const replier = document.createElement('div');
        replier.classList.add('replier');
        replier.appendChild(this.info);
        replier.appendChild(form);
        return replier;
    }

    /**
     * Sends the message held by the given form.
     * @param {HTMLFormElement} form The form which contains the message.
     * @return {Promise<String>} The message returned by the server.
     */
    async send(form) {
        const content = form.elements['content'].value;
        return sendMessageToServer(content, this.threadId)
            .then((response) => response.text())
            .then((status) => this.printStatus(status));
    }

    /**
     * Displays the given message in the {@link Replier}'s information box.
     *
     * Should probably be called with a response returned by the server.
     *
     * @param {string} status The message which gets displayed.
     */
    printStatus(status) {
        this.info.textContent = status;
    }
}

/**
 * Tries to post a message on the server.
 * @param {string} content The main text of the message.
 * @param {number?} replyTo The id of the thread it's replying to.
 *     Should be `null` to start a new thread.
 * @return {Promise<Response>} The server's response.
 */
const sendMessageToServer = async (content, replyTo) => {
    return fetch(`/room/${roomName}/post`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            content: content,
            reply_to: replyTo,
        })
    });
};

/** Gets message updates from the server and redisplays all messages. */
const refreshMessages = async () => {
    const delta = await getDelta();
    await applyDelta(delta, threads);
    displayThreads(threads);
};

/**
 * Requests the next "delta" update from the server and returns its response.
 * @return {Promise<object>} The "delta" object returned by the server.
 * @throws Will throw an error if the response was not successful.
 */
const getDelta = async () => {
    return fetch(`/room/${roomName}/updates`)
        .then((response) => {
            if (!response.ok) {
                throw new Error('Message update response was not OK.');
            }
            return response.json();
        })
};

/**
 * Applies the given "delta update" to the threads' data structure.
 * @param {object} delta A "delta" object returned by the server in response to an update request.
 * @param {Map<number, Thread>} threads A map which associates ids with their threads.
 */
const applyDelta = async (delta, threads) => {
    let messages = JSON.parse(localStorage.getItem(`msg${roomName}`)) ?? new Map();

    if (delta.clean_stored) {
        messages = [];
        threads.clear();
    }

    // Store the new messages.
    messages.push(...delta.messages);
    localStorage.setItem(`msg${roomName}`, JSON.stringify(messages));

    // Add the new messages to the threads data structure.
    addMessagesToThreads(delta.messages, threads);
};

/**
 * Adds the given messages to the map of threads.
 *
 * Messages which start new threads receive new entries into the map, while
 * replies to existing threads are added to the corresponding lists of replies.
 *
 * @param {Array<Message>} messages A list of messages.
 * @param {Map<number, Thread>} threads A map which associates ids with their threads.
 */
const addMessagesToThreads = (messages, threads) => {
    for (const message of messages) {
        if (message.reply_to == null) {
            threads.set(message.id, new Thread(message));
        }
    }
    for (const message of messages) {
        if (message.reply_to != null) {
            threads.get(message.reply_to).addReply(new Message(message));
        }
    }
};

/**
 * Displays the given threads on the page, in the correct order.
 * @param {Map<number, Thread>} threads A map which associates ids with their threads.
 */
const displayThreads = (threads) => {
    // Get sorting parameters.
    const searchText = document.getElementById('search-text').value;
    const threadOrder = document.getElementById('thread-order').value;

    // Sort the threads.
    const orderedElements = [];
    for (const [_, thread] of threads.entries()) {
        const element = thread.asElement();
        const timestamp = thread.timestamp();

        let matches = 0;
        if (searchText) {
            const marker = new Mark(element);
            marker.mark(searchText, {
                separateWordSearch: false,
                done: (matchCount) => matches = matchCount
            });
        }

        orderedElements.push({
            element: element,
            timestamp: timestamp,
            matches: matches,
        });
    }
    orderedElements.sort((a, b) => {
        if (a.matches !== b.matches) {
            return b.matches - a.matches;
        }
        if (threadOrder === 'new') {
            return b.timestamp - a.timestamp;
        }
        return a.timestamp - b.timestamp;
    });

    // Place the sorted elements.
    const messageBox = document.getElementById('message-box');
    messageBox.innerHTML = ''; // Remove older messages;
    for (const orderedElement of orderedElements) {
        messageBox.appendChild(orderedElement.element);
    }
};

/** Scrolls the document to the last position stored in the browser. */
const scrollToStoredPos = () => {
    document.documentElement.scrollTop = sessionStorage.getItem(`scroll${roomName}`);
};

/**
 * Makes the given textarea element automatically resizable (vertically).
 *
 * The resizing mechanism is triggered both when the content of the element
 * changes, and when this function in called.
 *
 * @param {HTMLTextAreaElement} textarea The textarea element.
 */
const makeTextareaResizable = (textarea) => {
    /**
     * Resizes a textarea element vertically to fit its content better,
     * while still obeying its `max-height` and `min-height` properties.
     * @param {HTMLTextAreaElement} elem The textarea element.
     */
    const autoResize = (elem) => {
        const style = window.getComputedStyle(elem);
        const min = parseInt(style.minHeight, 10) || -Infinity;
        const max = parseInt(style.maxHeight, 10) || Infinity;

        elem.style.height = 'auto';
        const wantedHeight = elem.scrollHeight;
        const newHeight = Math.min(max, Math.max(min, wantedHeight));
        elem.style.height = `${newHeight}px`;
    };

    autoResize(textarea);
    textarea.addEventListener('input', () => autoResize(textarea));
};

// Set up the form which creates a new thread.
window.addEventListener('load', () => {
    const info = document.getElementById('new-thread-info');
    const form = document.getElementById('new-thread-form');

    form.onsubmit = (event) => {
        event.preventDefault();

        const content = form.elements['content'].value;
        const replyTo = null;

        sendMessageToServer(content, replyTo)
            .then((response) => response.text())
            .then(async (status) => {
                info.textContent = status;
                await refreshMessages();
                scrollToStoredPos();
            });
    }
});

// Set up the components of the bar used for sorting threads.
window.addEventListener('load', () => {
    const searchText = document.getElementById('search-text');
    searchText.value = sessionStorage.getItem('searchText') ?? '';

    // We want the threads to update "dynamically", as we type.
    searchText.addEventListener('input', () => {
        sessionStorage.setItem('searchText', searchText.value);
        displayThreads(threads);
    });

    const clearSearchButton = document.getElementById('clear-search-button');
    clearSearchButton.addEventListener('click', () => {
        searchText.value = '';
        searchText.dispatchEvent(new Event('input'));
    });

    const threadOrder = document.getElementById('thread-order');
    threadOrder.value = sessionStorage.getItem('threadOrder') ?? threadOrder.value;
    threadOrder.addEventListener('change', () => {
        sessionStorage.setItem('threadOrder', threadOrder.value);
        displayThreads(threads);
    });
});

// Set up the text box which allows quick navigation to another room.
window.addEventListener('load', () => {
    // Add the current room to the set of rooms seen.
    const roomsList = JSON.parse(localStorage.getItem('roomsSeen')) ?? [];
    const roomsSeen = new Set(roomsList);
    roomsSeen.add(roomName);
    localStorage.setItem('roomsSeen', JSON.stringify([...roomsSeen]));

    // Populate the datalist.
    const datalist = document.getElementById('rooms-seen');
    datalist.innerHTML = '';
    for (const name of roomsSeen) {
        const option = document.createElement('option');
        option.value = name;
        datalist.appendChild(option);
    }

    // Redirect to the chosen room when pressing `Enter` while writing its name.
    const goToRoom = document.getElementById('go-to-room');
    goToRoom.addEventListener('keyup', (event) => {
        event.preventDefault();

        const wantedRoomName = goToRoom.value.trim();
        if (event.keyCode === 13 && wantedRoomName) {
            location.assign(`/room/${wantedRoomName}`);
        }
    });
});

// Set up the pane for color-customization.
window.addEventListener('load', () => {
    // Set up the button which displays the dropdown.
    const content = document.getElementById('colors-dropdown-content');
    const button = document.getElementById('colors-dropdown-button');
    button.onclick = () => content.classList.toggle('dropdown-show');
    window.addEventListener('click', (event) => {
        // Hide the dropdown when the user clicks outside of it.
        if (event.target !== button) {
            content.classList.remove('dropdown-show');
        }
    });

    // Buttons for preset themes.
    document.getElementById('light-theme-button').onclick = () => changeColors({
        '--background1': '#eceff1',
        '--background2': '#90a4ae',
        '--primary1': '#cfd8dc',
        '--primary2': '#b0bec5',
        '--secondary1': '#960018',
        '--secondary2': '#7c0a02',
        '--extra1': '#fafafa',
        '--extra2': '#c21807',
        '--text-color1': '#000000',
        '--text-color2': '#660000',
        '--text-color3': '#ffffff',
        '--text-color4': '#fafafa',
        '--text-faded1': '#424242',
        '--mark-background': '#fafafa',
        '--mark-text-color': '#660000',
    });
    document.getElementById('dark-theme-button').onclick = () => changeColors({
        '--background1': '#121212',
        '--background2': '#1f282d',
        '--primary1': '#1f282d',
        '--primary2': '#263a38',
        '--secondary1': '#e64a19',
        '--secondary2': '#d84315',
        '--extra1': '#090c0d',
        '--extra2': '#d84315',
        '--text-color1': '#eceff1',
        '--text-color2': '#ff5722',
        '--text-color3': '#000000',
        '--text-color4': '#eceff1',
        '--text-faded1': '#90a4ae',
        '--mark-background': '#1f282d',
        '--mark-text-color': '#ff5722',
    });
});

// Set up the button for refreshing messages more easily.
window.addEventListener('load', () => {
    const refreshButton = document.getElementById('refresh-button');
    refreshButton.addEventListener('click', async () => {
        await refreshMessages();
        scrollToStoredPos();
    });
});

// The textarea for creating new threads should resize automatically.
window.addEventListener('load', () => {
    const textarea = document.getElementById('new-thread-content');
    makeTextareaResizable(textarea);

    // Dispatch the event needed for resizing manually when resetting.
    const form = document.getElementById('new-thread-form');
    form.addEventListener('reset', (event) => {
        event.preventDefault();
        textarea.value = '';
        textarea.dispatchEvent(new Event('input')); // Resize after clearing.
    });
});

// When the window loads, we want to display all messages sent by the server
// and scroll to the right position.
window.addEventListener('load', async () => {
    // Reload the stored messages into memory.
    threads = new Map();
    const storedMessages = JSON.parse(localStorage.getItem(`msg${roomName}`)) ?? [];
    addMessagesToThreads(storedMessages, threads);

    // Request updates from the server and display all messages.
    await refreshMessages();
    scrollToStoredPos();
});

// We want the scroll position to be "persistent" between refreshes,
// so we store it when it changes.
window.addEventListener('scroll', () => {
    sessionStorage.setItem(`scroll${roomName}`, document.documentElement.scrollTop);
});
