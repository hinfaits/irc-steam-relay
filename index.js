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

  var slackChannelId = "";
  
  var lastSteamMsgTime = (new Date()).getTime();
  var queue = [];
  
  function sendSteam(msg) {
    if (steam.loggedOn) {
      steam.sendMessage(details.chatroom, msg);
    } else {
      queue.push(msg);
    }
  }
  
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
      slackWeb.chat.postMessage(slackChannelId, message, {username: name, icon_url: STEAM_ICON}, function() {});
    } else if (msgType == Steam.EChatEntryType.Emote) {
      // Steam emotes were removed a few years ago
      slackWeb.chat.postMessage(slackChannelId, message, {username: name, icon_url: STEAM_ICON}, function() {});
    }
    
    var parts = message.split(/\s+/);
    var permissions = steam.chatRooms[chatRoom][chatter].permissions;
    
    if (parts[0] == '.k' && permissions & Steam.EChatPermission.Kick) {
      // irc.send('KICK', details.ircChannel, parts[1], 'requested by ' + name);
      
    } else if (parts[0] == '.kb' && permissions & Steam.EChatPermission.Ban) {
      // irc.send('MODE', details.ircChannel, '+b', parts[1]);
      // irc.send('KICK', details.ircChannel, parts[1], 'requested by ' + name);
      
    } else if (parts[0] == '.unban' && permissions & Steam.EChatPermission.Ban) {
      // irc.send('MODE', details.ircChannel, '-b', parts[1]);
      
    } else if (parts[0] == '.userlist') {
    //   irc.send('NAMES', details.ircChannel);
    //   irc.once('names' + details.ircChannel, function(nicks) {
    //     steam.sendMessage(chatter, 'Users in ' + details.ircChannel + ':\n' + Object.keys(nicks).map(function(key) {
    //       return nicks[key] + key;
    //     }).join('\n'));
    //   });
    // }
  });


  // Restarts the connection to Steam if no messages have been received in 3 hours
  // Very useful for netsplits
  // Checks status every 5 minutes
  function steamReconnect() {
    var reconnectInterval = 3 * 3600 * 1000;
    var now = (new Date()).getTime();
    if (now - lastSteamMsgTime > reconnectInterval) {
      lastSteamMsgTime = (new Date()).getTime();
      steam.logOff();
      console.log("Steam reconnect in 5s.")
      setTimeout(function() {
        steam.logOn({
          accountName: details.username,
          password: details.password,
          authCode: details.authCode,
          shaSentryfile: require('fs').existsSync('sentry') ? require('fs').readFileSync('sentry') : undefined
        });
      }, 5*1000);
    } else {
      // timeToReconnect = (reconnectInterval - (now - lastSteamMsgTime)) / 1000;
      // console.log("Steam reconnect scheduled in " + timeToReconnect + " seconds.");
    }
    setTimeout(steamReconnect, 5 * 60 * 1000);
  }
  setTimeout(steamReconnect, 5 * 60 * 1000);  
  
  steam.on('chatStateChange', function(stateChange, chatterActedOn, chat, chatterActedBy) {
    var name = steam.users[chatterActedOn].playerName + ' (http://steamcommunity.com/profiles/' + chatterActedOn + ')';
    switch (stateChange) {
      case Steam.EChatMemberStateChange.Entered:
        var msg = 'Steam - ' + name + ' entered chat.';
        slackWeb.chat.postMessage(slackChannelId, msg, {as_user: true}, function() {});
        break;
      case Steam.EChatMemberStateChange.Left:
        var msg = 'Steam - ' + name + ' left chat.';
        slackWeb.chat.postMessage(slackChannelId, msg, {as_user: true}, function() {});
        break;
      case Steam.EChatMemberStateChange.Disconnected:
        var msg = 'Steam - ' + name + ' disconnected.';
        slackWeb.chat.postMessage(slackChannelId, msg, {as_user: true}, function() {});
        break;
      case Steam.EChatMemberStateChange.Kicked:
        var msg = 'Steam - ' + name + ' was kicked by ' + steam.users[chatterActedBy].playerName + '.';
        slackWeb.chat.postMessage(slackChannelId, msg, {as_user: true}, function() {});
        break;
      case Steam.EChatMemberStateChange.Banned:
        var msg = 'Steam - ' + name + ' was banned by ' + steam.users[chatterActedBy].playerName + '.';
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
    logLevel: 'error', // check this out for more on logger: https://github.com/winstonjs/winston
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

    try {
      // TODO: Instead of ignoring all bots, should just ignore messages from this bot
      if (message.subtype == "bot_message" || message.user == details.botid) {
        return;
      }

      var channelName = slackRtm.dataStore.getChannelGroupOrDMById(message.channel).name;

      if (channelName != details.slackChannel) {
        return;
      }

      var userName = slackRtm.dataStore.getUserById(message.user).name;
      sendSteam('<' + userName + '> ' + message.text);
    }
    catch (e) {
      // TODO: Figure out what triggers this block
      console.log("Slack messaging handling caught exception handling");
      console.log(e);
      console.log((new Date()).toUTCString());
    }
};
