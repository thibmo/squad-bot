/**
 * SR-Rcon
 * RCON class for interfacing with Valve RCON for games like Squad
 * © 2021 Smoking Rifles
 */
const { Socket, createConnection } = require('net'),
    { EventEmitter }               = require('events'),
    { Buffer }                     = require('buffer'),
    { Logger }                     = require('./logger');

/**
 * @typedef {Object} ClassConfigOptions
 * @property {number} [maximumPacketSize=4096] Maximum packet bytes size, zero to unlimit
 * @property {('ascii'|'utf8')} [encoding='utf8'] Socket encoding
 * @property {number} [timeout=1000] Socket timeout (ms)
 */

const PacketType = {
    COMMAND:        0x02,
    RESPONSE_VALUE: 0x00,
    AUTH:           0x03,
    RESPONSE_AUTH:  0x02,
    CHAT_VALUE:     0x01
};

const MID_PACKET_ID = 0x01;
const END_PACKET_ID = 0x02;

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

        /**
         * Server host address
         * @type {string}
         * @default '127.0.0.1'
         */
        this.host = host || '127.0.0.1';
        /**
         * Server port
         * @type {number}
         * @default 21114
         */
        this.port = port || 21114;
        /**
         * Maximum packet bytes size, zero to unlimit
         * @type {number}
         * @default 4096
         */
        this.maximumPacketSize = options.maximumPacketSize || 4096; // https://developer.valvesoftware.com/wiki/Source_RCON#Packet_Size
        /**
         * Socket encoding
         * @type {('ascii'|'utf8')}
         * @default 'utf8'
         */
        this.encoding = options.encoding || 'utf8';
        /**
         * Socket timeout (ms)
         * @type {number}
         * @default 1000
         */
        this.timeout = options.timeout || 1000;
        /**
         * RCON auth password
         * @type {string}
         * @default ''
         */
        this.password = password || '';
        /**
         * Whether server has been authenticated
         * @type {boolean}
         * @default false
         * @private
         */
        this.hasAuthed = false;
        /**
         * Any remaining data that has yet to be read and processed
         * @type {Buffer}
         * @default null
         * @private
         */
        this.outstandingData = null;

        this.incomingData = Buffer.from([]);
        this.incomingResponse = [];

        this.responseCallbackQueue = [];

        // internal variables
        this.connected = false;
        this.autoReconnect = false;
        this.autoReconnectTimeout = null;

        this.autoReconnectDelay = 5000;

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
            this.connected = true;
            //this.emit('connect');
            this._client.removeListener('error', onError);
            this.connected = true;

            try {
                // connected successfully, now try auth... (0x03)
                this._write(PacketType.AUTH, this.password);
                // connected and authed successfully
                this.autoReconnect = true;
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

        this._client.connect(this.port, this.host);
    }

    /**
     * Event to trigger on socket connect
     * @private
     */
    _socketOnError(err) {
        this.emit('error', err);
    }

    _socketOnClose(hadError) {
        this.connected = false;
        Logger.warn('RCON', '_socketOnClose', `Socket closed ${hadError ? 'without' : 'with'} an error.`);

        if (this.autoReconnect) {
            Logger.info('RCON', '_socketOnClose', `Sleeping ${this.autoReconnectDelay}ms before reconnecting.`);
            setTimeout(this.connect, this.autoReconnectDelay);
        }
    }

    /**
     * Event to trigger on socket data receive
     * @param {Buffer} data
     * @private
     */
    _socketOnData(data) {
        Logger.debug('RCON', '_socketOnData', `Got data: ${this.bufToHexString(data)}`);
        // the logic in this method simply splits data sent via the data event into packets regardless of how they're distributed in the event calls
        const packets = this._decodeData(data);

        for (const packet of packets) {
            const decodedPacket = this._decodePacket(packet);

            switch (decodedPacket.type) {
                case PacketType.RESPONSE_VALUE:
                case PacketType.RESPONSE_AUTH:
                    switch (decodedPacket.id) {
                        case MID_PACKET_ID:
                            this.incomingResponse.push(decodedPacket);
                            break;
                        case END_PACKET_ID:
                            this.responseCallbackQueue.shift()(
                                this.incomingResponse.map((packet) => packet.body).join()
                            );
                            this.incomingResponse = [];
                            break;
                        default: {}
                    }
                    break;

                case PacketType.CHAT_VALUE:
                    // this.processChatPacket(decodedPacket);
                    this.emit('chat', decodedPacket.body);
                    break;

                default: {}
            }
        }
    }

    _decodeData(data) {
        this.incomingData = Buffer.concat([this.incomingData, data]);

        const packets = [];

        // we check that it's greater than 4 as if it's not then the length header is not fully present which breaks the rest of the code.
        // We just need to wait for more data.
        while (this.incomingData.byteLength >= 4) {
            const size = this.incomingData.readInt32LE(0);
            const packetSize = size + 4;

            // The packet following an empty packet will report to be 10 long (14 including the size header bytes), but in
            // it should report 17 long (21 including the size header bytes). Therefore, if the packet is 10 in size
            // and there's enough data for it to be a longer packet then we need to probe to check it's this broken packet.
            const probeSize = 17;
            const probePacketSize = 21;

            if (size === 10 && this.incomingData.byteLength >= probeSize) {
                // copy the section of the incoming data of interest
                const probeBuf = this.incomingData.slice(0, probePacketSize);
                // decode it
                const decodedProbePacket = this._decodePacket(probeBuf);

                // check whether body matches
                if (decodedProbePacket.body === '\x00\x00\x00\x01\x00\x00\x00') {
                    // it does so it's the broken packet remove the broken packet from the incoming data
                    this.incomingData = this.incomingData.slice(probePacketSize);
                    Logger.debug('RCON', '_decodeData', `Ignoring some data: ${this.bufToHexString(probeBuf)}`);
                    continue;
                }
            }

            if (this.incomingData.byteLength < packetSize) {
                Logger.debug('RCON', '_decodeData', 'Waiting for more data...');
                break;
            }

            const packet = this.incomingData.slice(0, packetSize);
            packets.push(packet);

            this.incomingData = this.incomingData.slice(packetSize);
        }

        return packets;
    }

    _decodePacket(packet) {
        return {
            size: packet.readInt32LE(0),
            id: packet.readInt32LE(4),
            type: packet.readInt32LE(8),
            body: packet.toString('utf8', 12, packet.byteLength - 2)
        };
    }

    _write(type, body) {
        if (!this.connected) {
            this.emit('error', new Error('Not connected.'));
            return;
        }

        if (!this._client.writable) {
            this.emit('error', new Error('Unable to write to socket.'));
            return;
        }

        const encodedPacket = this._encodePacket(type, type !== PacketType.AUTH ? MID_PACKET_ID : END_PACKET_ID, body);
        Logger.debug('RCON', '_write', `encodedPacket: ${this.bufToHexString(encodedPacket)}`);

        const encodedEmptyPacket = this._encodePacket(type, END_PACKET_ID, '');
        Logger.debug('RCON', '_write', `encodedEmptyPacket: ${this.bufToHexString(encodedEmptyPacket)}`);

        if (this.maximumPacketSize < encodedPacket.length) {
            this.emit('error', new Error('Packet too long.'));
            return;
        }

        const onError = (err) => {
            this.responseCallbackQueue = [];
            this.emit('error', err);
        };

        // the auth packet also sends a normal response, so we add an extra empty action to ignore it
        if (type === PacketType.AUTH) {
            this.responseCallbackQueue.push(() => {});
            this.responseCallbackQueue.push((decodedPacket) => {
                this._client.removeListener('error', onError);

                if (decodedPacket.id === -1) {
                    this.emit('error', new Error('Authentication failed.'));
                } else {
                    this.emit('authed', null);
                }
            });
        } else {
            this.responseCallbackQueue.push((body) => {
                this._client.removeListener('error', onError);
                this.emit('response', body);
            });
        }

        this._client.once('error', onError);

        Logger.debug('RCON', '_write', `Sending packet: ${this.bufToHexString(encodedPacket)}`);
        this._client.write(encodedPacket);

        if (type !== PacketType.AUTH)
            this._client.write(encodedEmptyPacket);
    }

    _encodePacket(type, id, body, encoding = 'utf8') {
        const size = Buffer.byteLength(body) + 14;
        const buf = Buffer.alloc(size);

        buf.writeInt32LE(size - 4, 0);
        buf.writeInt32LE(id, 4);
        buf.writeInt32LE(type, 8);
        buf.write(body, 12, size - 2, encoding);
        buf.writeInt16LE(0, size - 2);

        return buf;
    }

    bufToHexString(buf) {
        return buf.toString('hex').match(/../g).join(' ');
    }

    execute(command) {
        this._write(PacketType.COMMAND, command);
    }

    disconnect() {
        if (this._connection)
            this._connection.end();
    }
};

module.exports = Rcon;
