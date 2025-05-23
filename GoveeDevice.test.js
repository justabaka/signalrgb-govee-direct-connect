import {encode, decode} from "@SignalRGB/base64";
import udp from "@SignalRGB/udp";

const PROTOCOL_SINGLE_COLOR = 3;
const GRADIENT_OFF_SKUS = [
    "H610A",
    "H6056",
    "H6047",
    "H610B",
    "H6046",
    "H6608",
    "H6609",
    "H606A",
    "H6065",
    "H6066",
    "H6067",
    "H6061",
    "H6043",
    "H6042",
    "H70BC",
    "H6063",
    "H6069",
    "H8069"
];

export default class GoveeDevice
{
    constructor(data)
    {
        if (data)
        {
            this.id = (data.hasOwnProperty('id')) ? data.id : null;
            this.ip = data.ip;
            this.leds = parseInt(data.leds);
            this.type = parseInt(data.type);
            this.split = data.split ? parseInt(data.split) : 1;
            this.sku = data.hasOwnProperty('sku') ? data.sku : null;
            this.firmware = data.hasOwnProperty('bleVersionSoft') ? data.bleVersionSoft : null;
            this.name = (data.hasOwnProperty('name')) ? data.name : this.generateName();
            this.uniquePort = (data.hasOwnProperty('uniquePort') ? data.uniquePort : null);
        }

        this.testMode = (!this.id);
        
        this.onOff = 0;
        this.pt = null;
        this.port = 4003;
        this.statusPort = 4001;
        this.enabled = true;
        this.renderingDisabledUntil = 0;

        this.razerOn = false;

        this.lastRender = 0;
        this.lastStatus = 0;
        this.defaultAlertSuppressionDuration = 600;
        this.lastDeviceDataCheck = 0;
        this.lastSingleColor = '';

        this.hasChanged = false;
    }

    handleSocketMessage(message)
    {
        try
        {
            let goveeResponse = JSON.parse(message.data);
            if (goveeResponse.hasOwnProperty('msg'))
            {
                switch(goveeResponse.msg.cmd)
                {
                    case 'scan':
                        this.update(goveeResponse.msg.data);
                        break;
                    case 'status':
                    case 'devStatus':
                        this.updateStatus(goveeResponse.msg.data);
                        break;
                    case 'disconnect':
                        this.disconnectSocket();
                        break;
                    default:
                        this.log('Received unknown command');
                        this.log(message.data);
                        break;
                }
            }
            else if (goveeResponse.hasOwnProperty('alertActive'))
            {
                switch(goveeResponse.alertActive)
                    {
                        case "true":
                            this.renderingDisabledUntil = Date.now() + this.defaultAlertSuppressionDuration;
                            this.log('Disabling rendering due to an alert...');
                            break;
                        case "false":
                            this.renderingDisabledUntil = 0;
                            this.log('Re-enabling rendering!');
                            break;
                        default:
                            break;
                    }
            }
        } catch(err)
        {
            this.log(err.message);
        }
    }

    handleSocketError(errorId, errorMessage)
    {
        this.log(errorMessage);
    }

    handleListening()
    {
        const address = this.udpServer.address();
        this.log(`Started listening on`);
        this.log(address);
    }

    handleConnection()
    {
        // this.log('Connected to');
        // this.log(this.udpServer.remoteAddress());
    }

    disconnectSocket()
    {
        this.udpServer.close();
        this.udpServer = null;
    }

    setupUdpServer()
    {
        if (this.uniquePort)
        {
            if (this.udpServer) return;

            this.udpServer = udp.createSocket();
            this.udpServer.on('message', this.handleSocketMessage.bind(this));
            this.udpServer.on('error', this.handleSocketError.bind(this));
            this.udpServer.on('listening', this.handleListening.bind(this));

            // Listen to this device specific port
            this.udpServer.bind(this.uniquePort);
        }
    }

    save()
    {
        if (this.id)
        {
            // Create a new setting specifically for that device
            service.saveSetting(this.id, 'ip', this.ip);
            service.saveSetting(this.id, 'leds', this.leds);
            service.saveSetting(this.id, 'type', this.type);
            service.saveSetting(this.id, 'split', this.split);
            service.saveSetting(this.id, 'sku', this.sku);
            service.saveSetting(this.id, 'firmware', this.firmware);
            service.saveSetting(this.id, 'name', this.name);
            service.saveSetting(this.id, 'uniquePort', this.uniquePort);

            this.log('Saved device');
            this.printDetails(service);
        } else
        {
            this.log('Data not yet received by device, saving device data later');
        }

        return this;
    }

    log(text)
    {
        if (typeof service !== 'undefined')
        {
            service.log(text);
        } else
        {
            device.log(text);
        }
    }

    toCacheJSON()
    {
        return {
            id: this.id,
            ip: this.ip,
            name: this.name,
            leds: this.leds,
            type: this.type,
            split: this.split,
            uniquePort: this.uniquePort
        };
    }

    load(id)
    {
        this.id         = id;
        this.ip         = service.getSetting(id, 'ip');
        this.leds       = service.getSetting(id, 'leds');
        this.type       = service.getSetting(id, 'type');
        this.split      = service.getSetting(id, 'split');
        this.sku        = service.getSetting(id, 'sku');
        this.firmware   = service.getSetting(id, 'firmware');
        this.name       = service.getSetting(id, 'name');
        this.uniquePort = service.getSetting(id, 'uniquePort');

        this.log('Loaded device');
        this.printDetails(service);

        return this;
    }

    update(receivedData)
    {
        let hasChanged = false;
        
        if (this.id !== receivedData.device)
        {
            this.id = receivedData.device;
            hasChanged = true;
        }

        if (this.sku !== receivedData.sku)
        {
            this.sku = receivedData.sku;
            hasChanged = true;
        }

        if (this.firmware !== receivedData.bleVersionSoft)
        {
            this.firmware = receivedData.bleVersionSoft;
            hasChanged = true;
        }
        
        if (hasChanged)
        {
            this.name       = this.generateName();
            this.testMode   = false;
            this.hasChanged = hasChanged;
        }
    }

    updateStatus(receivedData)
    {
        if (this.onOff !== receivedData.onOff)
        {
            this.log(`Changed onOff from ${this.onOff} to ${receivedData.onOff}`);
            this.onOff = receivedData.onOff;
        }

        if (this.pt !== receivedData.pt)
        {
            this.pt = receivedData.pt;
            this.decodePTData(receivedData.pt);
        }
    }

    generateName()
    {
        return `Govee ${this.sku ? this.sku : 'device'} on ${this.ip}`;
    }

    getName()
    {
        return this.name;
    }

    printDetails(logger)
    {
        logger.log(`Name: ${this.name}`);
        logger.log(`SKU: ${this.sku}`);
        logger.log(`Firmware: ${this.firmware}`);
        logger.log(`IP address: ${this.ip}`);
        logger.log(`Total LED count: ${this.leds}`);
        switch(this.type)
        {
            // Dreamview mode
            case 1:
                logger.log(`Protocol: Dreamview`);
                break;
            case 2:
                logger.log(`Protocol: Razer`);
                break;
            case 3:
                logger.log(`Protocol: Solid color`);
                break;
            case 4:
                logger.log(`Protocol: Legacy Razer protocol`);
                break;
        }
        switch(this.split)
        {
            case 1:
                logger.log(`Split: Single logger`);
                break;
            case 2:
                logger.log(`Split: Mirrored`);
                break;
            case 3:
                logger.log(`Split: Two devices`);
                break;
            case 4:
                logger.log(`Split: Custom components`);
                break;
        }
    }

    decodePTData(pt)
    {
        if (pt !== null)
        {
            const byteArrayPt = decode(pt);
            if (byteArrayPt[3] == 0xb2)
            {
                this.razerOn = (byteArrayPt[4] == 0x01) ? true : false;
                if (this.razerOn) this.log('Turned razer mode on');
            }
        }
    }

    getStatus()
    {
        const statusPacket = { msg: { cmd: "status", data: {} } };
        this.send(statusPacket);
    }

    requestDeviceData()
    {
        this.log('Asking device for device data');
        const deviceDataRequestPacket = {msg: { cmd: 'scan', data: {account_topic: 'reserve'} }};
        this.send(deviceDataRequestPacket, this.statusPort)
    }

    getGradientOff()
    {
        if (this.sku === null) return 1;
        return (GRADIENT_OFF_SKUS.includes(this.sku)) ? 0 : 1;
    }

    getRazerModeCommand(enable)
    {
        let command = encode([0xBB, 0x00, 0x01, 0xB1, enable, enable ? 0x0A : 0x0B]);
        return { msg: { cmd: "razer", data: { pt: command } } };
    }

    getColorCommand(colors)
    {
        let command = {};

        switch(this.type)
        {
            // Dreamview mode
            case 1:
                command = this.getDreamViewCommand(colors);
                break;
            case 2:
                command = this.getRazerCommand(colors);
                break;
            case 3:
                command = this.getSolidColorCommand(colors);
                break;
            case 4:
                command = this.getRazerLegacyCommand(colors);
                break;
            case 5:
                command = this.getDreamViewV2Command(colors);
                break;
        }
        
        return { msg: command };
    }

    getDreamViewV2Command(colors)
    {
        let collection = [
            this.getGradientOff(),
            colors.length,
        ];
        
        for (let c = 0; c < colors.length; c++)
        {
            let color = colors[c];
            collection = collection.concat(color);

            if (c < 36)
            {
                collection.push(1);
            } else
            {
                collection.push(2);
            }
        }

        let dreamViewHeader = [
            0xBB,
            (collection.length >> 8 & 0xFF),
            (collection.length & 0xFF),
            0xB4,
        ];

        let colorsCommand = dreamViewHeader.concat(collection);
        colorsCommand.push( this.calculateXorChecksum(colorsCommand) );

        return {cmd: "razer", data: { pt: encode(colorsCommand) } };
    }

    getDreamViewCommand(colors)
    {
        let collection = [
            this.getGradientOff(),
            colors.length,
        ];
        
        for (let c = 0; c < colors.length; c++)
        {
            let color = colors[c];
            collection = collection.concat(color);
        }

        let dreamViewHeader = [
            0xBB,
            (collection.length >> 8 & 0xFF),
            (collection.length & 0xFF),
            0xB0,
        ];

        let colorsCommand = dreamViewHeader.concat(collection);
        colorsCommand.push( this.calculateXorChecksum(colorsCommand) );

        return {cmd: "razer", data: { pt: encode(colorsCommand) } };
    }

    getRazerCommand(colors)
    {
        let razerHeader = [0xBB, 0x00, 0x0E, 0xB0, 0x01, colors.length];
        
        let colorsCommand = razerHeader;
        for(let c = 0; c < colors.length; c++)
        {
            // Color is an [r,g,b] array
            let color = colors[c];
            colorsCommand = colorsCommand.concat(color);
        }

        // Add razer checksum
        colorsCommand.push( this.calculateXorChecksum(colorsCommand) );
        // colorsCommand.push(0);

        return {cmd: "razer", data: { pt: encode(colorsCommand) } };
    }

    getRazerLegacyCommand(colors)
    {
        let razerHeader = [0xBB, 0x00, 0x0E, 0xB0, 0x01, colors.length];
        
        let colorsCommand = razerHeader;
        for(let c = 0; c < colors.length; c++)
        {
            // Color is an [r,g,b] array
            let color = colors[c];
            colorsCommand = colorsCommand.concat(color);
        }

        // Add razer checksum
        colorsCommand.push(0);

        return {cmd: "razer", data: { pt: encode(colorsCommand) } };
    }

    getSolidColorCommand(colors)
    {
        let color = colors[0];
        return {
            cmd: "colorwc",
            data: {
                color: {r: color[0], g: color[1], b: color[2]},
                colorTemInKelvin: 0
            }
        }
        
    }

    calculateXorChecksum(packet) {
        let checksum = 0;
        for (let i = 0; i < packet.length; i++) {
          checksum ^= packet[i];
        }
        return checksum;
    }

    sendRGB(colors, now, frameDelay)
    {
        if (this.enabled && now - this.renderingDisabledUntil >= 0)
        {
            if (this.split == 2)
            {
                colors = colors.concat(colors);
            }

            // Every 60 minutes check if the device data has updated (like firmware changes)
            if (now - this.lastDeviceDataCheck > 60 * 60 * 1000)
            {
                this.requestDeviceData();
                this.lastDeviceDataCheck = now;

                // Not sending more commands to not overload
                return;
            }
    
            // Every 20 seconds check if we need to enable razer
            if (now - this.lastRender > 20 * 1000)
            {
                // Check if we have the device data already
                if (this.id == null)
                {
                    // There's no unique ID, so we need to get that data
                    this.requestDeviceData();
                }
                
                this.lastRender = now;

                // Not sending more commands to not overload
                return
            }

            // Every 10 seconds check the status
            if (this.id !== null && now - this.lastStatus > 10 * 1000)
            {
                // HACK: sometimes a device never turns on after PC wake up from sleep/hibernation so it's easier just to send turnOn commands every X seconds
                this.turnOn();

                this.getStatus();
                this.lastStatus = now;
                return
            }

            // We're just going to assume some things
            // This is because the device sometimes refuses to send us info
            if (!this.onOff)
            {
                this.turnOn();
                this.onOff = true;
            }

            if (this.type !== PROTOCOL_SINGLE_COLOR)
            {
                if (!this.razerOn)
                {
                    this.send(this.getRazerModeCommand(true));
                    this.razerOn = true;
                }
            }

            // If the device is on or we don't have any data yet (we just assume its on)
            if (this.onOff)
            {
                try
                {
                    // Send RGB command first, then do calculations and stuff later
                    let colorCommand = this.getColorCommand(colors);
                    this.send(colorCommand);
                } catch(ex)
                {
                    device.error(ex.message);
                    device.error(colors);
                }
                

                frameDelay = parseInt(frameDelay);
                if (frameDelay > 0)
                {
                    device.pause(frameDelay);
                }
            }
        }
    }

    singleColor(color, now)
    {
        if (now - this.lastRender > 10000)
        {
            // Turn off Razer mode
            if (this.razerOn)
            {
                this.log('Sending `razer off` command');
                this.send(this.getRazerModeCommand(false));
            }

            this.getStatus();
            this.lastRender = now;
        }

        let jsonColor = JSON.stringify(color);
        if (jsonColor !== this.lastSingleColor)
        {
            this.lastSingleColor = jsonColor;
            let colorCommand = this.getSolidColorCommand([color]);
            this.log('Sending new color code ' + JSON.stringify(colorCommand));
            this.send({msg: colorCommand});
        }
    }

    send(command, port)
    {
        this.udpServer.write(command, this.ip, port ? port : this.port);
    }

    turnOff()
    {
        this.pt = null;
        this.razerOn = false;
        this.onOff = 0;
        this.enabled = false;
        // Set color to black
        this.singleColor([0,0,0], 0);
        // Turn device off
        this.send({ msg: { cmd: "turn", data: { value: 0 } } });
    }

    turnOn()
    {
        this.send({ msg: { cmd: "turn", data: { value: 1 } } });
    }
}