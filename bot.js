//Requirements
const Discordjs          = require("discord.js"),
    Steamquery           = require("gamedig"),
    Rcon                 = require("./sr-rcon"),
    { Logger, LogLevel } = require('./logger');

global.botstart = new Date();
Logger.setLogLevel(LogLevel.INFO);
Logger.info('Bot', 'Start', 'Start Script');

var settingspath = "./settings/settings.json";
global.secrets = require(settingspath);

//Global Variables & Paths
global.varcommands = [
];

// Cosntants
const rconNextMapRegex = /Next level is (?<NextLevel>.+), layer is (?<NextLayer>.+)[_, ](?<NextMode>AAS|RAAS|TA|TC|Destruction|Invasion|Skirmish|Tanks)[_, ](?<NextVersion>[v,V]\d+(?: night)?)*/;
const rconChatRegEx = /\[(?<Chattype>[A-z]+?)\] \[SteamID:(?<SteamID>\d+?)\] (?<Name>.+?) : (?<Message>.*)/;
const rconCommandRegEx = new RegExp(secrets.prefix + "(?<command>admin|report) ?(?<ReportMessage>.*)", "i");
const dcordMessagecontentregexp = new RegExp(secrets.prefix + "(?<message>.*)");
const dcordCommandregexp = /(?<command>\w*)[ ]?(?<arguments>.*)/;

//Discord Client
const DiscordClient = new Discordjs.Client();
DiscordClient.on("ready", () => {
        Logger.info(
            'Discord',
            'Connection',
            `Connected Username: ${DiscordClient.user.tag} ID: ${DiscordClient.user.id} | ${DiscordClient.guilds.cache.size} Server`
        );
        global.botuserid = DiscordClient.user.id;
        interval();
    })
    /*
    .on("message", async message => {
        if (!message.content.startsWith(secrets.prefix) || message.author == DiscordClient.user || message.author.bot == true)
            return;

        const messagecontent = dcordMessagecontentregexp.exec(message.content).groups.message; //Returns the received Message without the Prefix
        const command = dcordCommandregexp.exec(messagecontent).groups.command; // Returns the Command
        const arguments = dcordCommandregexp.exec(messagecontent).groups.arguments;

        if (arguments != "")
            arguments = arguments.split(" ");

        //Used to change Variables defiend in global.varcommands
        const commandvalid = global.varcommands[containsinarray(command, global.varcommands)[0]];

        if (
            commandvalid != undefined &&
            (message.member._roles.includes(secrets.discordserveradminroleid) && message.channel.id == secrets.discordcontrolchannelid)
        ) {
            const embed = {
                description: "Variable [" + commandvalid + "]: " + global[commandvalid] + "\nConfig [" + commandvalid + "]: " +
                secrets[commandvalid],
                color: 65339, //green
                timestamp: new Date().toISOString(),
                author: { name: secrets.servernameshort + "-Bot" }
            };

            if (arguments.length >= 1) {
                if (arguments[0] == "false") {
                    global[commandvalid] = false;
                } else if (arguments[0] == "true") {
                    global[commandvalid] = true;
                }

                embed.description = "Variable [" + commandvalid + "]:SET}=> " + global[commandvalid];

                if (arguments.length == 2) {
                    if (arguments[1] == "p") {
                        embed.description = "Variable [" + commandvalid + "]:SET-Persitent}=> " +
                        global[commandvalid];
                        secrets[commandvalid] = global[commandvalid];
                        rewriteconfig();
                    }
                }
            }

            message.channel.send({ embed });
            Logger.debug('Discord', 'Message', embed.description);
        }
    })
    */
    /*
    .on("raw", async event => {
        if (event.t == "MESSAGE_REACTION_ADD") {
            const guildid = event.d.guild_id;
            const channelid = event.d.channel_id;
            const messageid = event.d.message_id;
            const userid = event.d.user_id;
            const emoji = event.d.emoji;

            if (channelid == secrets.discordreportchannelid && !(userid == global.botuserid) && global.admincall == true) {
                DiscordClient.channels.fetch(channelid).then((channel) => {
                    channel.fetchMessage(messageid).then(message => {
                        const user = DiscordClient.users.resolve(userid);
                        authorname = message.embeds[0].author.name;
                        timestamp = message.embeds[0].timestamp;
                        content = message.embeds[0].description;

                        if (emoji.name == "✅") {
                            rconsend('AdminWarn "' + authorname + '" Your submission has been processed and marked as completed.');
                        } else if (emoji.name == "📞") {
                            rconsend(
                                'AdminWarn "' + authorname +
                                '" Your submission has been reviewed, but a more detailed interaction is required. Please come to our Discord Server. \n' +
                                secrets.discordinvitelink + "\nMessage " + user.username + "#" + user.discriminator + " for further discussion."
                            );
                        }
                    });
                });
            }
        }
    })
    */
    .on("error", function(err) {
        Logger.error('Discord', 'Error', 'Discord Connection Error', err.stack);
        DiscordClient.login(secrets.discordtoken);
    });

DiscordClient.login(secrets.discordtoken);

//Functions
function rconsend(command) {
    Logger.debug('RCON', 'Send', command);
    rcon.execute(command);
}

//RCON Client
const rcon = new Rcon(
    secrets.serverip,
    secrets.rconport,
    secrets.rconpassword,
    {
        maximumPacketSize: 4096,
        encoding: 'utf8'
    }
);
rcon.on('authed', function() {
        Logger.info('RCON', 'Auth', `Connected to ${rcon.host}:${rcon.port}`);
    })
    .on('response', function(str) {
        Logger.debug('RCON', 'Response', str);
        //Answer of the GetNextMap Command sended via the Interval
        const nextMapMatch = rconNextMapRegex.exec(str);

        if (nextMapMatch) {
            const NextLevel = nextMapMatch.groups.NextLevel;
            const NextLayer = nextMapMatch.groups.NextLayer;
            const NextMode = nextMapMatch.groups.NextMode;
            const NextVersion = nextMapMatch.groups.NextVersion;
            Logger.debug('RCON', 'Response', `NextLevel = ${NextLevel} | NextLayer = ${NextLayer} | NextMode = ${NextMode} | NextVersion = ${NextVersion}`);

            //Steamquery
            Steamquery.query({
                type: "squad",
                host: secrets.serverip,
                port: secrets.steamqueryport,
                maxAttempts: 3,
                socketTimeout: 5000,
                attemptTimeout: 10000,
                debug: false
            }).then(Serverquery => {
                const PlayerCount = Serverquery.raw.rules.PlayerCount_i;
                const MaxPlayerCount = Serverquery.maxplayers - Serverquery.raw.rules.PlayerReserveCount_i;
                var activity = '';

                if (PlayerCount == 0) {
                    activity = "Server is Empty 💤";
                } else {
                    activity = `(${PlayerCount}/${MaxPlayerCount})`;
                }

                DiscordClient.user.setActivity(
                    `${activity} | CM: ${Serverquery.map.replace(/_/g, ' ')} | NM: ${NextLayer} ${NextMode} ${NextVersion}`,
                    { type: 'PLAYING' }
                );
            }).catch(error => {
                Logger.error('SteamQuerry', 'Error', error);
            });
        }
    })
    .on('chat', function(str) {
        //Chat Formatter --- Still breaks on " : " in Username or Clantag
        Logger.debug('RCON', 'Chat', str);
        const chatmatch = rconChatRegEx.exec(str);
        const chattype = chatmatch.groups.Chattype; //Type of Chat
        const steamid = chatmatch.groups.SteamID; //Sender SteamID
        const name = chatmatch.groups.Name; //Sender Steamname (could include Clantag)
        const message = chatmatch.groups.Message; //Chatmessage
        Logger.debug(
            'RCON',
            'Chat',
            `[Formatter]chatmatch : ${chatmatch} | chattype : ${chattype} | steamid : ${steamid} | name : ${name} | message : ${message}`
        );

        if (message.charAt(0) == secrets.prefix) {
            const Commandmatch = rconCommandRegEx.exec(message);
            Logger.debug('RCON', 'Chat', `[Formatter]message : ${message} | Commandmatch : ${Commandmatch} | rconCommandRegEx : ${rconCommandRegEx}`);

            if (Commandmatch != null) {
                const command = Commandmatch.groups.command.toLowerCase();
                const ReportMessage = Commandmatch.groups.ReportMessage;
                Logger.debug('RCON', 'Chat', `[Formatter]command : ${command} | ReportMessage : ${ReportMessage}`);

                /*
                if ((command == "admin" || command == "report") && global.admincall == true) {
                    //Create Embedded Discord Message
                    const embed = {
                        description: ReportMessage,
                        color: 2124210, //Blue
                        timestamp: new Date().toISOString(),
                        author: {
                            name: name,
                            url: "https://www.battlemetrics.com/players?filter%5Bsearch%5D=" + steamid + "&filter%5Bservers%5D=" +
                                secrets.battlemetricsid + "&sort=score",
                            icon_url: "https://cdn.iconscout.com/icon/free/png-512/messaging-15-461719.png"
                        }
                    };

                    DiscordClient.channels.fetch(secrets.discordreportchannelid).then((reportchannel) => {
                        var here = secrets.admincallping;
                        var i = 0;
                        var mute = false;

                        if (fs.existsSync(mutelistpath)) {
                            var text = fs.readFileSync(mutelistpath, "utf8");
                            var mutelist = text.split("\r\n");

                            while (i < mutelist.length) {
                                if (mutelist[i] == name) {
                                    here = "muted User";
                                    mute = true;
                                }

                                i++;
                            }
                        }

                        reportchannel.send(here, { embed }).then(function(message) {
                            message.react("📞").then(message.react("✅")).then(message.react("⏳")).then(message.react("❌")).then(() => {
                                if (mute == false) {
                                    message.react("🚫");
                                    rconsend('AdminWarn "' + name + '" Your Report has been submitted. An admin will take care of it as soon as possible.');
                                } else {
                                    rconsend('AdminWarn "' + name + '" Your Report has been submitted.');
                                }
                            });
                        });
                    });
                }
                */
            }
        }
    })
    .on('end', function() {
        Logger.warn('RCON', 'End', 'RCON Connection Closed');
        rcon.connect();
    })
    .on('error', function(err) {
        //if (err.code != "ETIMEDOUT")
            Logger.error('RCON', 'Error', 'RCON Connection Error', err.stack);

        rcon.connect();
    });

rcon.connect();

//All 30 Seconds
function interval() {
    rconsend("ShowNextMap");
}

$ongoingupdates = setInterval(function() {
    interval();
}, 30000);
