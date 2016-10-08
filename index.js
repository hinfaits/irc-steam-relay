var Steam = require('steam');
var fs = require('fs');

var Slack = require('@slack/client');
var WebClient = Slack.WebClient;
var RtmClient = Slack.RtmClient;
var MemoryDataStore = Slack.MemoryDataStore;
var CLIENT_EVENTS = Slack.CLIENT_EVENTS;
var RTM_EVENTS = Slack.RTM_EVENTS;

var IRC_ICON = "https://raw.githubusercontent.com/hinfaits/irc-steam-relay/master/static/icon/irc_icon.png";
var STEAM_ICON = "https://raw.githubusercontent.com/hinfaits/irc-steam-relay/master/static/icon/steam_icon.png";

// if we've saved a server list, use it
if (fs.existsSync('servers')) {
  Steam.servers = JSON.parse(fs.readFileSync('servers'));
}

module.exports = function(details) {
  var msgFormat = details.msgFormat || '\u000302%s\u000f: %s';
  var emoteFormat = details.emoteFormat || '\u000302%s %s';
  var msgFormatGame = details.msgFormatGame || details.msgFormat || '\u000303%s\u000f: %s';
  var emoteFormatGame = details.emoteFormatGame || details.emoteFormat || '\u000303%s %s';
  
  var slackChannelId = "";
  
  var queue = [];
  
  function sendSteam(msg) {
    if (steam.loggedOn) {
      steam.sendMessage(details.chatroom, msg);
    } else {
      queue.push(msg);
    }
  }
  
  var irc = new (require('irc')).Client(details.server, details.nick, {
    channels: [details.ircChannel]
  });
  
  irc.on('error', function(err) {
    console.log('IRC error: ', err);
  });
  
  irc.on('message' + details.ircChannel, function(from, message) {
    sendSteam('<' + from + '> ' + message);
    slackWeb.chat.postMessage(slackChannelId, message, {username: from, icon_url: IRC_ICON}, function() {});

    if (!steam.loggedOn)
      return;
    
    var parts = message.match(/(\S+)\s+(.*\S)/);
    
    var triggers = {
      '.k': 'kick',
      '.kb': 'ban',
      '.unban': 'unban'
    };
    
    if (parts && parts[1] in triggers) {
      irc.whois(from, function(info) {
        if (info.channels.indexOf('@' + details.ircChannel) == -1)
          return; // not OP, go away
        
        Object.keys(steam.users).filter(function(steamID) {
          return steam.users[steamID].playerName == parts[2];
        }).forEach(function(steamID) {
          steam[triggers[parts[1]]](details.chatroom, steamID);
        });
      });
    } else if (message.trim() == '.userlist') {
      Object.keys(steam.chatRooms[details.chatroom]).forEach(function(steamID) {
        irc.notice(from, steam.users[steamID].playerName + ' http://steamcommunity.com/profiles/' + steamID);
      });
    }
  });
  
  irc.on('action', function(from, to, message) {
    if (to == details.ircChannel) {
      sendSteam(from + ' ' + message);
      slackWeb.chat.postMessage(slackChannelId, message, {username: from, icon_url: IRC_ICON}, function() {});
    }
  });
  
  irc.on('+mode', function(channel, by, mode, argument, message) {
    if (channel == details.ircChannel && mode == 'b') {
      var msg = 'IRC - ' + by + ' sets ban on ' + argument;
      sendSteam(msg);
      slackWeb.chat.postMessage(slackChannelId, msg, {as_user: true}, function() {});
    }
  });
  
  irc.on('-mode', function(channel, by, mode, argument, message) {
    if (channel == details.ircChannel && mode == 'b') {
      var msg = 'IRC - ' + by + ' removes ban on ' + argument;
      sendSteam(msg);
      slackWeb.chat.postMessage(slackChannelId, msg, {as_user: true}, function() {});
    }
  });
  
  irc.on('kick' + details.ircChannel, function(nick, by, reason, message) {
    var msg = 'IRC - ' + by + ' has kicked ' + nick + ' from ' + details.ircChannel + ' (' + reason + ')';
    sendSteam(msg);
    slackWeb.chat.postMessage(slackChannelId, msg, {as_user: true}, function() {});
  });
  
  irc.on('join' + details.ircChannel, function(nick) {
    var msg = 'IRC - ' + nick + ' has joined ' + details.ircChannel;
    sendSteam(msg);
    slackWeb.chat.postMessage(slackChannelId, msg, {as_user: true}, function() {});
  });
  
  irc.on('part' + details.ircChannel, function(nick) {
    var msg = 'IRC - ' + nick + ' has left ' + details.ircChannel;
    sendSteam(msg);
    slackWeb.chat.postMessage(slackChannelId, msg, {as_user: true}, function() {});
  });
  
  irc.on('quit', function(nick, reason) {
    var msg = 'IRC - ' + nick + ' has quit (' + reason + ')';
    sendSteam(msg);
    slackWeb.chat.postMessage(slackChannelId, msg, {as_user: true}, function() {});
  });
  
  var steam = new Steam.SteamClient();
  steam.logOn({
    accountName: details.username,
    password: details.password,
    authCode: details.authCode,
    shaSentryfile: require('fs').existsSync('sentry') ? require('fs').readFileSync('sentry') : undefined
  });
  
  steam.on('servers', function(servers) {
    fs.writeFile('servers', JSON.stringify(servers));
  });
  
  steam.on('loggedOn', function(result) {
    console.log('Logged on!');
    
    steam.setPersonaState(Steam.EPersonaState.Online);
    steam.joinChat(details.chatroom);
    
    queue.forEach(sendSteam);
    queue = [];
  });
  
  steam.on('chatMsg', function(chatRoom, message, msgType, chatter) {
    var game = steam.users[chatter].gameName;
    var name = steam.users[chatter].playerName;
    if (msgType == Steam.EChatEntryType.ChatMsg) {
      irc.say(details.ircChannel, require('util').format(game ? msgFormatGame : msgFormat, name, message));
    } else if (msgType == Steam.EChatEntryType.Emote) {
      irc.say(details.ircChannel, require('util').format(game ? emoteFormatGame : emoteFormat, name, message));
    }
    if (msgType == Steam.EChatEntryType.ChatMsg) {
      slackWeb.chat.postMessage(slackChannelId, message, {username: name, icon_url: STEAM_ICON}, function() {});
    }
    
    var parts = message.split(/\s+/);
    var permissions = steam.chatRooms[chatRoom][chatter].permissions;
    
    if (parts[0] == '.k' && permissions & Steam.EChatPermission.Kick) {
      irc.send('KICK', details.ircChannel, parts[1], 'requested by ' + name);
      
    } else if (parts[0] == '.kb' && permissions & Steam.EChatPermission.Ban) {
      irc.send('MODE', details.ircChannel, '+b', parts[1]);
      irc.send('KICK', details.ircChannel, parts[1], 'requested by ' + name);
      
    } else if (parts[0] == '.unban' && permissions & Steam.EChatPermission.Ban) {
      irc.send('MODE', details.ircChannel, '-b', parts[1]);
      
    } else if (parts[0] == '.userlist') {
      irc.send('NAMES', details.ircChannel);
      irc.once('names' + details.ircChannel, function(nicks) {
        steam.sendMessage(chatter, 'Users in ' + details.ircChannel + ':\n' + Object.keys(nicks).map(function(key) {
          return nicks[key] + key;
        }).join('\n'));
      });
    }
  });
  
  steam.on('chatStateChange', function(stateChange, chatterActedOn, chat, chatterActedBy) {
    var name = steam.users[chatterActedOn].playerName + ' (http://steamcommunity.com/profiles/' + chatterActedOn + ')';
    switch (stateChange) {
      case Steam.EChatMemberStateChange.Entered:
        var msg = 'Steam - ' + name + ' entered chat.';
        irc.say(details.ircChannel, msg);
        slackWeb.chat.postMessage(slackChannelId, msg, {as_user: true}, function() {});
        break;
      case Steam.EChatMemberStateChange.Left:
        var msg = 'Steam - ' + name + ' left chat.';
        irc.say(details.ircChannel, msg);
        slackWeb.chat.postMessage(slackChannelId, msg, {as_user: true}, function() {});
        break;
      case Steam.EChatMemberStateChange.Disconnected:
        var msg = 'Steam - ' + name + ' disconnected.';
        irc.say(details.ircChannel, msg);
        slackWeb.chat.postMessage(slackChannelId, msg, {as_user: true}, function() {});
        break;
      case Steam.EChatMemberStateChange.Kicked:
        var msg = 'Steam - ' + name + ' was kicked by ' + steam.users[chatterActedBy].playerName + '.';
        irc.say(details.ircChannel, msg);
        slackWeb.chat.postMessage(slackChannelId, msg, {as_user: true}, function() {});
        break;
      case Steam.EChatMemberStateChange.Banned:
        var msg = 'Steam - ' + name + ' was banned by ' + steam.users[chatterActedBy].playerName + '.';
        irc.say(details.ircChannel, msg);
        slackWeb.chat.postMessage(slackChannelId, msg, {as_user: true}, function() {});
    }
  });
  
  steam.on('loggedOff', function(result) {
    console.log("Logged off:", result);
  });
  
  steam.on('sentry', function(data) {
    require('fs').writeFileSync('sentry', data);
  })
  
  steam.on('debug', console.log);

  var slackWeb = new WebClient(details.slackToken);

  var slackRtm = new RtmClient(details.slackToken, {
    logLevel: 'debug', // check this out for more on logger: https://github.com/winstonjs/winston
    dataStore: new MemoryDataStore() // pass a new MemoryDataStore instance to cache information
  });

  slackRtm.start();

  slackRtm.on(CLIENT_EVENTS.RTM.AUTHENTICATED, function handleRTMAuthenticated() {
    console.log('Slack RTM client authenticated!');

    if (details.slackPrivate == true) {
      slackChannelId = slackRtm.dataStore.getGroupByName(details.slackChannel).id;
    } else {
      slackChannelId = slackRtm.dataStore.getChannelByName(details.slackChannel).id;
    }
  });

  slackRtm.on(RTM_EVENTS.MESSAGE, function handleRtmMessage(message) {

    // TODO: Instead of ignoring all bots, should just ignore messages from this bot
    if (message.subtype == "bot_message" || message.user == "U2KEF5VTR") {
      return;
    }

    var channelName = slackRtm.dataStore.getChannelGroupOrDMById(message.channel).name;

    if (channelName != details.slackChannel) {
      return;
    }

    var userName = slackRtm.dataStore.getUserById(message.user).name;
    irc.say(details.ircChannel, require('util').format(msgFormat, userName, message.text));
    sendSteam('<' + userName + '> ' + message.text);
  });
};
