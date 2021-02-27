/**
 * SR-Rcon
 * RCON class for interfacing with Valve RCON for games like Squad
 * © 2021 Smoking Rifles
 */
const { Socket }     = require('net'),
    { EventEmitter } = require('events'),
    { Buffer }       = require('buffer'),
    { Logger }       = require('./logger');

/**
 * @typedef {Object} ClassConfigOptions
 * @property {number} [maximumPacketSize=4096] Maximum packet bytes size, zero to unlimit
 * @property {('ascii'|'utf8')} [encoding='utf8'] Socket encoding
 */

/**
 * @typedef {Object} DecodedRconPacket
 * @property {number} size The packet's total size
 * @property {number} id The packet's ID
 * @property {PacketType|PacketResponseType} type The packet's type
 * @property {string} body The packet's body
 */

/**
 * The type of the packet to send
 * @private
 */
const PacketType = {
    /**
     * This packet type represents a command issued to the server by a client.
     * @type {number}
     */
    COMMAND: 0x02,
    /**
     * Typically, the first packet sent by the client will be an AUTH packet, which is used to authenticate the connection with the server.
     * @type {number}
     */
    AUTH:    0x03
};

/**
 * The type of the packet to recieve
 * @private
 */
const PacketResponseType = {
    /**
     * A RESPONSE_VALUE packet is the response to a COMMAND request.
     * @type {number}
     */
    RESPONSE_VALUE: 0x00,
    /**
     * A CHAT_VALUE packet is pushed by the RCON server when a chat message is sent
     * @type {number}
     */
    CHAT_VALUE:     0x01,
    /**
     * A RESPONSE_AUTH packet is the response to a AUTH request.
     * @type {number}
     */
    RESPONSE_AUTH:  0x02
};

/**
 * The ID of the packet to send/recieve
 * @private
 */
const PacketId = {
    /**
     * Mid-packet identifier for longer packet support
     * @type {number}
     */
    MID: 0x01,
    /**
     * End-packet identifier for longer packet support
     * @type {number}
     */
    END: 0x02
};

/**
 * RCON class, tailored to OWI's version of Valve RCON
 * @extends {EventEmitter}
 */
class Rcon extends EventEmitter {
    /**
     * @param {string} [host]
     * @param {string} [port]
     * @param {string} [password]
     * @param {ClassConfigOptions} [options]
     */
    constructor(host, port, password, options = {}) {
        super();

        if (!(this instanceof Rcon))
            return new Rcon(host, port, password, options);

        options = options || {};

        // internal variables
        /**
         * Server host address
         * @type {string}
         * @default '127.0.0.1'
         * @private
         */
        this._host = host || '127.0.0.1';
        /**
         * Server port
         * @type {number}
         * @default 21114
         * @private
         */
        this._port = port || 21114;
        /**
         * Maximum packet bytes size, zero to unlimit
         * @type {number}
         * @default 4096
         * @private
         */
        this._maximumPacketSize = options.maximumPacketSize || 4096; // https://developer.valvesoftware.com/wiki/Source_RCON#Packet_Size
        /**
         * Socket encoding
         * @type {('ascii'|'utf8')}
         * @default 'utf8'
         * @private
         */
        this._encoding = options.encoding || 'utf8';
        /**
         * RCON auth password
         * @type {string}
         * @default ''
         * @private
         */
        this._password = password || '';
        /**
         * Any remaining data that has yet to be read and processed
         * @type {Buffer}
         * @private
         */
        this._incomingData = Buffer.from([]);
        /**
         * Incomming response stack
         * @type {DecodedRconPacket[]}
         * @private
         */
        this._incomingResponse = [];
        /**
         * Response callback stack
         * @type {Function[]}
         * @private
         */
        this._responseCallbackQueue = [];
        /**
         * Indicates whether or not the socket is connected
         * @type {boolean}
         * @private
         */
        this._connected = false;
        /**
         * Indicates whether or not the socket should auto-reconnect
         * @type {boolean}
         * @private
         */
        this._autoReconnect = false;
        /**
         * The auto-reconnect delay in MS
         * @type {number}
         * @private
         */
        this._autoReconnectDelay = 5000;

        // bind methods
        this.connect = this.connect.bind(this); // we bind this as we call it on the auto reconnect timeout
        this._socketOnData = this._socketOnData.bind(this);
        this._socketOnClose = this._socketOnClose.bind(this);
        this._socketOnError = this._socketOnError.bind(this);

        // setup socket
        /**
         * @type {Socket}
         * @private
         */
        this._client = new Socket();
        this._client.setNoDelay(true); // Disable Nagle's algorithm
        this._client.setKeepAlive(true);
        this._client.on('data', this._socketOnData);
        this._client.on('close', this._socketOnClose);
        this._client.on('error', this._socketOnError);
    }

    /**
     * Connect and handle any connection errors
     */
    connect() {
        const onConnect = () => {
            this.emit('connect');
            this._client.removeListener('error', onError);
            this._connected = true;

            try {
                // connected successfully, now try auth... (0x03)
                this._write(PacketType.AUTH, this._password);
            } catch (err) {
                this.emit('error', err);
            }
        };

        const onError = (err) => {
            this._client.removeListener('connect', onConnect);
            this.emit('error', err);
        };

        this._client.once('connect', onConnect);
        this._client.once('error', onError);

        this._client.connect(this._port, this._host);
    }

    /**
     * Event to trigger on socket connect
     * @private
     */
    _socketOnError(err) {
        this.emit('error', err);
    }

    /**
     * Event to trigger on socket close
     * @param {boolean} hadError
     * @private
     */
    _socketOnClose(hadError) {
        this._connected = false;
        Logger.warn('RCON', '_socketOnClose', `Socket closed ${hadError ? 'without' : 'with'} an error.`);

        if (this._autoReconnect) {
            Logger.info('RCON', '_socketOnClose', `Sleeping ${this._autoReconnectDelay}ms before reconnecting.`);
            setTimeout(this.connect, this._autoReconnectDelay);
        }
    }

    /**
     * Event to trigger on socket data receive
     * @param {Buffer} data
     * @private
     */
    _socketOnData(data) {
        Logger.debug('RCON', '_socketOnData', `Got data: ${this._bufToHexString(data)}`);
        // the logic in this method simply splits data sent via the data event into packets regardless of how they're distributed in the event calls
        const packets = this._decodeData(data);

        for (const packet of packets) {
            const decodedPacket = this._decodePacket(packet);

            switch (decodedPacket.type) {
                case PacketResponseType.RESPONSE_VALUE:
                case PacketResponseType.RESPONSE_AUTH:
                    switch (decodedPacket.id) {
                        case PacketId.MID:
                            this._incomingResponse.push(decodedPacket);
                            break;
                        case PacketId.END:
                            this._responseCallbackQueue.shift()(
                                this._incomingResponse.map((packet) => packet.body).join()
                            );
                            this._incomingResponse = [];
                            break;
                        default: {}
                    }
                    break;
                case PacketResponseType.CHAT_VALUE:
                    // this.processChatPacket(decodedPacket);
                    this.emit('chat', decodedPacket.body);
                    break;
                default: {}
            }
        }
    }

    /**
     * Decode incomming data
     * @param {Buffer} data
     * @returns {Buffer[]}
     * @private
     */
    _decodeData(data) {
        this._incomingData = Buffer.concat([this._incomingData, data]);

        const packets = [];

        // we check that it's greater than 4 as if it's not then the length header is not fully present which breaks the rest of the code.
        // We just need to wait for more data.
        while (this._incomingData.byteLength >= 4) {
            const size = this._incomingData.readInt32LE(0);
            const packetSize = size + 4;

            // The packet following an empty packet will report to be 10 long (14 including the size header bytes), but in
            // it should report 17 long (21 including the size header bytes). Therefore, if the packet is 10 in size
            // and there's enough data for it to be a longer packet then we need to probe to check it's this broken packet.
            const probeSize = 17;
            const probePacketSize = 21;

            if (size === 10 && this._incomingData.byteLength >= probeSize) {
                // copy the section of the incoming data of interest
                const probeBuf = this._incomingData.slice(0, probePacketSize);
                // decode it
                const decodedProbePacket = this._decodePacket(probeBuf);

                // check whether body matches
                if (decodedProbePacket.body === '\x00\x00\x00\x01\x00\x00\x00') {
                    // it does so it's the broken packet remove the broken packet from the incoming data
                    this._incomingData = this._incomingData.slice(probePacketSize);
                    Logger.debug('RCON', '_decodeData', `Ignoring some data: ${this._bufToHexString(probeBuf)}`);
                    continue;
                }
            }

            if (this._incomingData.byteLength < packetSize) {
                Logger.debug('RCON', '_decodeData', 'Waiting for more data...');
                break;
            }

            const packet = this._incomingData.slice(0, packetSize);
            packets.push(packet);

            this._incomingData = this._incomingData.slice(packetSize);
        }

        return packets;
    }

    /**
     * Decode a single buffer slice into a usable packet
     * @param {Buffer} packet
     * @returns {DecodedRconPacket}
     * @private
     */
    _decodePacket(packet) {
        return {
            size: packet.readInt32LE(0),
            id: packet.readInt32LE(4),
            type: packet.readInt32LE(8),
            body: packet.toString(this._encoding, 12, packet.byteLength - 2)
        };
    }

    /**
     * Write an actual request to the socket
     * @param {PacketType} type
     * @param {string} body
     */
    _write(type, body) {
        if (!this._connected) {
            this.emit('error', new Error('Not connected.'));
            return;
        }

        if (!this._client.writable) {
            this.emit('error', new Error('Unable to write to socket.'));
            return;
        }

        const encodedPacket = this._encodePacket(type, type !== PacketType.AUTH ? PacketId.MID : PacketId.END, body);
        Logger.debug('RCON', '_write', `encodedPacket: ${this._bufToHexString(encodedPacket)}`);

        const encodedEmptyPacket = this._encodePacket(type, PacketId.END, '');
        Logger.debug('RCON', '_write', `encodedEmptyPacket: ${this._bufToHexString(encodedEmptyPacket)}`);

        if (this._maximumPacketSize < encodedPacket.length) {
            this.emit('error', new Error('Packet too long.'));
            return;
        }

        const onError = (err) => {
            this._responseCallbackQueue = [];
            this.emit('error', err);
        };

        // the auth packet also sends a normal response, so we add an extra empty action to ignore it
        if (type === PacketType.AUTH) {
            this._responseCallbackQueue.push(() => {});
            this._responseCallbackQueue.push((decodedPacket) => {
                this._client.removeListener('error', onError);

                if (decodedPacket.id === -1) {
                    this.emit('error', new Error('Authentication failed.'));
                } else {
                    // connected and authed successfully
                    this._autoReconnect = true;
                    this.emit('authed', null);
                }
            });
        } else {
            this._responseCallbackQueue.push((body) => {
                this._client.removeListener('error', onError);
                this.emit('response', body);
            });
        }

        this._client.once('error', onError);

        Logger.debug('RCON', '_write', `Sending packet: ${this._bufToHexString(encodedPacket)}`);
        this._client.write(encodedPacket);

        if (type !== PacketType.AUTH)
            this._client.write(encodedEmptyPacket);
    }

    /**
     * Encode a packet into a Valve RCON packet
     * @param {PacketType} type
     * @param {PacketId} id
     * @param {string} body
     * @returns {Buffer}
     * @private
     */
    _encodePacket(type, id, body) {
        const size = Buffer.byteLength(body) + 14;
        const buf = Buffer.alloc(size);

        buf.writeInt32LE(size - 4, 0);
        buf.writeInt32LE(id, 4);
        buf.writeInt32LE(type, 8);
        buf.write(body, 12, size - 2, this._encoding);
        buf.writeInt16LE(0, size - 2);

        return buf;
    }

    /**
     * Dump a buffer into a hex-string
     * @param {Buffer} buf
     * @returns {string}
     * @private
     */
    _bufToHexString(buf) {
        return buf.toString('hex').match(/../g).join(' ');
    }

    /**
     * Execute an RCON command
     * @param {string} command
     */
    execute(command) {
        this._write(PacketType.COMMAND, command);
    }

    /**
     * Disconnect the RCON socket
     */
    disconnect() {
        if (this._connection && this._connected)
            this._connection.end();
    }
};

module.exports = Rcon;
