/*\
title: $:/plugins/OokTech/Bob/NodeMessageHandlers.js
type: application/javascript
module-type: startup

These are message handler functions for the web socket servers. Use this file
as a template for extending the web socket funcitons.

This handles messages sent to the node process.
\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

exports.platforms = ["node"];

if ($tw.node) {
  $tw.connections = $tw.connections || [];
  $tw.Bob = $tw.Bob || {};
  $tw.Bob.Shared = require('$:/plugins/OokTech/Bob/SharedFunctions.js');
  // This lets you add to the $tw.nodeMessageHandlers object without overwriting
  // existing handler functions
  $tw.nodeMessageHandlers = $tw.nodeMessageHandlers || {};
  // Ensure that the browser tiddler list object exists without overwriting an
  // existing copy.
  $tw.BrowserTiddlerList = $tw.BrowserTiddlerList || {};

  var sendAck = function (data) {
    if (data.id) {
      if (data.source_connection !== undefined) {
        $tw.connections[data.source_connection].socket.send(JSON.stringify({type: 'ack', id: data.id}));
      }
    }
  }

  /*
    This handles when the browser sends the list of all tiddlers that currently
    exist in the browser version of the wiki. This is different than the list of
    all tiddlers in files.
  */
  $tw.nodeMessageHandlers.browserTiddlerList = function(data) {
    // Save the list of tiddlers in the browser as part of the $tw object so it
    // can be used elsewhere.
    $tw.BrowserTiddlerList[data.source_connection] = data.titles;
    $tw.CreateSettingsTiddlers(data.wiki);
    $tw.connections[data.source_connection].wikiName = data.wiki;
    sendAck(data);
  }

  /*
    This is just a test function to make sure that everthing is working.
    It displays the contents of the received data in the console.
  */
  $tw.nodeMessageHandlers.test = function(data) {
    console.log(data);
  }

  /*
    This responds to a ping from the browser. This is used to check and make sure
    that the browser and server are connected.
    It also echos back any data that was sent. This is used by the heartbeat to
    make sure that the server and browser are still connected.
  */
  $tw.nodeMessageHandlers.ping = function(data) {
    var message = {};
    //var message = {type: 'pong'};
    Object.keys(data).forEach(function (key) {
      message[key] = data[key];
    })
    message.type = 'pong';
    if (data.heartbeat) {
      message.heartbeat = true;
    }
    // When the server receives a ping it sends back a pong.
    var response = JSON.stringify(message);
    $tw.connections[data.source_connection].socket.send(response);
  }

  /*
    This handles saveTiddler messages sent from the browser.

    TODO: Determine if we always want to ignore draft tiddlers.

    Waiting lists are per-connection so use regular titles.
    Editing lists are global so need prefixes
    Saving uses normal titles
    $tw.boot uses prefixed titles
  */
  $tw.nodeMessageHandlers.saveTiddler = function(data) {
    // Make sure there is actually a tiddler sent
    if (data.tiddler) {
      // Make sure that the tiddler that is sent has fields
      if (data.tiddler.fields) {
        // Ignore draft tiddlers
        if (!data.tiddler.fields['draft.of']) {
          var prefix = data.wiki || '';
          var internalTitle = '{' + prefix + '}' + data.tiddler.fields.title;
          // Set the saved tiddler as no longer being edited. It isn't always
          // being edited but checking eacd time is more complex than just
          // always setting it this way and doesn't benifit us.
          $tw.nodeMessageHandlers.cancelEditingTiddler({tiddler:internalTitle, wiki: prefix});
          // If we are not expecting a save tiddler event than save the
          // tiddler normally.
          if (!$tw.boot.files[internalTitle]) {
            $tw.syncadaptor.saveTiddler(data.tiddler, prefix);
          } else {
            // If changed send tiddler
            var changed = true;
            try {
              if (data.tiddler.fields._canonical_uri) {
                var tiddlerObject = $tw.loadTiddlersFromFile($tw.boot.files[internalTitle].filepath+'.meta');
              } else {
                var tiddlerObject = $tw.loadTiddlersFromFile($tw.boot.files[internalTitle].filepath);
              }
              // The file has the normal title so use the normal title here.
              changed = $tw.Bob.Shared.TiddlerHasChanged(data.tiddler, tiddlerObject);
            } catch (e) {
              //console.log(e);
            }
            if (changed) {
              $tw.syncadaptor.saveTiddler(data.tiddler, prefix);
              // Set the wiki as modified
              $tw.Bob.Wikis[prefix].modified = true;
            }
          }
          delete $tw.Bob.EditingTiddlers[internalTitle];
          $tw.Bob.UpdateEditingTiddlers(false);
        }
      }
    }
    // Acknowledge the message.
    sendAck(data);
  }

  /*
    This is the handler for when the browser sends the deleteTiddler message.
  */
  $tw.nodeMessageHandlers.deleteTiddler = function(data) {
    //console.log('Node Delete Tiddler');
    // Make the internal name
    data.tiddler = '{' + data.wiki + '}' + data.tiddler;
    // Delete the tiddler file from the file system
    $tw.syncadaptor.deleteTiddler(data.tiddler);
    // Set the wiki as modified
    $tw.Bob.Wikis[data.wiki].modified = true;
    // Remove the tiddler from the list of tiddlers being edited.
    if ($tw.Bob.EditingTiddlers[data.tiddler]) {
      delete $tw.Bob.EditingTiddlers[data.tiddler];
      $tw.Bob.UpdateEditingTiddlers(false);
    }
    // Acknowledge the message.
    sendAck(data);
  }

  /*
    This is the handler for when a browser sends the editingTiddler message.
  */
  $tw.nodeMessageHandlers.editingTiddler = function(data) {
    var internalName = '{' + data.wiki + '}' + data.tiddler;
    // Add the tiddler to the list of tiddlers being edited to prevent multiple
    // people from editing it at the same time.
    $tw.Bob.UpdateEditingTiddlers(internalName);
    // Acknowledge the message.
    sendAck(data);
  }

  /*
    This is the handler for when a browser stops editing a tiddler.
  */
  $tw.nodeMessageHandlers.cancelEditingTiddler = function(data) {
    // Make sure that the tiddler title is a string
    if (typeof data.tiddler === 'string') {
      if (data.tiddler.startsWith("Draft of '")) {
        var title = data.tiddler.slice(10,-1);
      } else {
        var title = data.tiddler;
      }
      var internalName = '{' + data.wiki + '}' + title;
      // Remove the current tiddler from the list of tiddlers being edited.
      if ($tw.Bob.EditingTiddlers[internalName]) {
        delete $tw.Bob.EditingTiddlers[internalName];
      }
      $tw.Bob.UpdateEditingTiddlers(false);
    }
    // Acknowledge the message.
    sendAck(data);
  }

  /*
    This lets us restart the tiddlywiki server without having to use the command
    line.
  */
  $tw.nodeMessageHandlers.restartServer = function(data) {
    if ($tw.node) {
      console.log('Restarting Server!');
      // Close web socket server.
      $tw.wss.close(function () {
        console.log('Closed WSS');
      });
      // This bit of magic restarts whatever node process is running. In this
      // case the tiddlywiki server.
      require('child_process').spawn(process.argv.shift(), process.argv, {
        cwd: process.cwd(),
        detached: false,
        stdio: "inherit"
      });
    }
  }

  /*
    This lets us shutdown the server from within the wiki.
  */
  $tw.nodeMessageHandlers.shutdownServer = function(data) {
    console.log('Shutting down server.');
    // TODO figure out if there are any cleanup tasks we should do here.
    // Sennd message to parent saying server is shutting down
    process.exit();
  }

  /*
    This updates the settings.json file based on the changes that have been made
    in the browser.
    TODO update this to work with child wikis
  */
  $tw.nodeMessageHandlers.saveSettings = function(data) {
    if (!path) {
      var path = require('path');
      var fs = require('fs');
    }
    var prefix = '{'+data.wiki+'}';
    // Get first tiddler to start out
    var tiddler = $tw.wiki.getTiddler(prefix + '$:/WikiSettings/split');
    var settings = JSON.stringify(buildSettings(tiddler, prefix), "", 2);
    // Update the settings tiddler in the wiki.
    var tiddlerFields = {
      title: prefix + '$:/WikiSettings',
      text: settings,
      type: 'application/json'
    };
    // Add the tiddler
    $tw.wiki.addTiddler(new $tw.Tiddler(tiddlerFields));
    // Push changes out to the browsers
    var tiddlerFields2 = {
      title: '$:/WikiSettings',
      text: settings,
      type: 'application/json'
    };
    $tw.Bob.SendToBrowsers({type: 'saveTiddler', tiddler: {fields: tiddlerFields2}});
    // Save the updated settings
    var userSettingsPath = path.join($tw.boot.wikiPath, 'settings', 'settings.json');
    if (!fs.existsSync(userSettingsPath)) {
      // Create the settings folder
      fs.mkdirSync(userSettingsPath);
    }
    fs.writeFile(userSettingsPath, settings, {encoding: "utf8"}, function (err) {
      if (err) {
        console.log(err);
      } else {
        console.log('Wrote settings file')
      }
    });
    // Update the $tw.settings object
    // First clear the settings
    $tw.settings = {};
    // Put the updated version in.
    $tw.updateSettings($tw.settings, JSON.parse(settings));

    $tw.CreateSettingsTiddlers();
  }

  function buildSettings (tiddler, prefix) {
    var settings = {};
    if (tiddler) {
      if (tiddler.fields) {
        var object = (typeof tiddler.fields.text === 'string')?JSON.parse(tiddler.fields.text):tiddler.fields.text;
        Object.keys(object).forEach(function (field) {
          if (typeof object[field] === 'string' || typeof object[field] === 'number') {
            if (String(object[field]).startsWith('$:/WikiSettings/split')) {
              // Recurse!
              var newTiddler = $tw.wiki.getTiddler(prefix + object[field]);
              settings[field] = buildSettings(newTiddler, prefix);
            } else {
              // Actual thingy!
              settings[field] = object[field];
            }
          } else {
            settings[field] = "";
          }
        });
      }
    }
    return settings;
  }

  /*
    This message lets you run a script defined in the settings.json file.
    You name and define the script there and then you can run it using this.

    The script must be listed in the settings. You send the script name with the
    message and then it takes the information for it from the settings file.

    settings file entries should be like this:

    "name": "somecommand argument argument"

    it would be easiest to write a script and then just call the script using
    this.

    If sequential is set to true than each script will only run after the
    previous script has finished in the order they are received.
    It is possible to run non-sequential scripts and sequential scripts
    simultaneously.
  */
  // This holds
  var scriptQueue = {};
  var scriptActive = {};
  var childproc = false;
  // This function checks if a script is currently running, if not it runs the
  // next script in the queue.
  function processScriptQueue (queue) {
    if (!scriptActive[queue] && scriptQueue[queue].length > 0) {
      childproc = require('child_process').spawn(scriptQueue[queue][0].command, scriptQueue[queue][0].args, scriptQueue[queue][0].options);
      scriptActive[queue] = true;
      childproc.on('error', function (err) {
        clearQueue(queue);
        console.log('Script error: ', err);
      })
      childproc.on('exit', function () {
        // Remove the finished task from the queue
        if (scriptQueue[queue].length > 0) {
          scriptQueue[queue].shift();
        }
        // Set the queue as inactive
        scriptActive[queue] = false;
        // Process the next task in the queue, if any.
        processScriptQueue(queue);
      });
    }
  }
  function clearQueue (queue) {
    scriptQueue[queue] = [];
    if (scriptActive[queue]) {
      childproc.kill('SIGINT');
    }
  }
  $tw.nodeMessageHandlers.runScript = function (data) {
    if (data.name) {
      if ($tw.settings.scripts) {
        if ($tw.settings.scripts[data.name]) {
          if (typeof $tw.settings.scripts[data.name] === 'string') {
            var splitThing = $tw.settings.scripts[data.name].split(" ");
            var command = splitThing.shift(),
            args = splitThing || [],
            options = {
              cwd: process.cwd(),
              detached: false,
              stdio: "inherit"
            };
            // If a command has an item that matches a property in the input
            // object than replace it with the value from the input object.
            Object.keys(data).forEach(function(item) {
              var index = args.indexOf(item);
              if (index !== -1) {
                args[index] = data[item];
              }
            });
            if (data.sequential) {
              data.queue = data.queue || 0;
              scriptActive[data.queue] = scriptActive[data.queue] || false;
              scriptQueue[data.queue] = scriptQueue[data.queue] || [];
              // Add the current script to the queue
              scriptQueue[data.queue].push({command: command, args: args, options: options, queue: data.queue});
              // Process the queue to run a command
              processScriptQueue(data.queue);
            } else {
              childproc = require('child_process').spawn(command, args, options);
              childproc.on('error', function (err) {
                console.log('Script error: ', err);
              })
            }
          }
        }
      }
    }
  }
  // Stop any currently running script queues
  $tw.nodeMessageHandlers.stopScripts = function (data) {
    data.queue = data.queue || 0;
    clearQueue(data.queue);
  }

  // This updates what wikis are being served and where they are being served
  $tw.nodeMessageHandlers.updateRoutes = function (data) {
    // This is only usable on the root wiki!
    if (data.wiki === 'RootWiki') {
      // Then clear all the routes to the non-root wiki
      $tw.httpServer.clearRoutes();
      // The re-add all the routes from the settings
      // This reads the settings so we don't need to give it any arguments
      $tw.httpServer.addOtherRoutes();
    }
  }

  // This builds a single file html version of the current wiki.
  // This is a simplifed version of the renderTiddler command because I
  // couldn't figure out how to just call that command here.
  // TODO let people give an include filter that can build a wiki from tiddlers
  // drawn from any of the served wikis.
  $tw.nodeMessageHandlers.buildHTMLWiki = function (data) {
    console.log('Build Wiki')
    var path = require('path')
    var fs = require('fs')
    var wikiPath, fullName, excludeList;
    if (data.buildWiki) {
      var exists = $tw.httpServer.loadWiki(data.buildWiki);
      if (exists) {
        wikiPath = $tw.Bob.Wikis[data.buildWiki].wikiPath || undefined;
        fullName = data.buildWiki;
      }
    } else {
      wikiPath = $tw.Bob.Wikis[data.wiki].wikiPath;
      fullName = data.wiki
    }
    if (data.excludeList) {
      // Get the excludeList from the provided filter, if it exists
      excludeList = $tw.wiki.filterTiddlers(data.excludeList);
    } else {
      // Otherwise we want to ignore the server-specific plugins to keep things
      // small.
      excludeList = ['$:/plugins/OokTech/Bob', '$:/plugins/tiddlywiki/filesystem', '$:/plugins/tiddlywiki/tiddlyweb'];
    }
    if (wikiPath) {
      var outputFolder = data.outputFolder || 'output';
      var outputName = data.outputName || 'index.html';
      var outputFile = path.resolve(wikiPath, outputFolder, outputName);
      $tw.utils.createFileDirectories(outputFile);
      // tiddlers for this wiki.
      var options = {
        variables: {
          wikiTiddlers:
            $tw.Bob.Wikis[fullName].tiddlers.concat($tw.Bob.Wikis[fullName].plugins.concat($tw.Bob.Wikis[fullName].themes)).map(function(tidInfo) {
              // This prevents the Bob plugin from being added to the wiki
              // It also strips out the filesystem and tiddlyweb plugins
              if (excludeList.indexOf(tidInfo) === -1) {
                return '[[' + tidInfo + ']]';
              } else {
                return '';
              }
            }).join(' '),
          wikiName: fullName
        }
      };
      var text = $tw.wiki.renderTiddler('text/plain','$:/plugins/OokTech/Bob/save/single', options);
      fs.writeFile(outputFile,text,"utf8",function(err) {
        if (err) {
            console.log(err);
          } else {
            console.log('Built Wiki: ', outputFile);
          }
      });
    } else {
      console.log("Can't find wiki ", fullName, ", is it listed in the Bob settings tab?");
    }
  }

  /*
    This lets you select a wiki html file and split it into individual tiddlers
    and create a new node wiki for it.
    It also adds the new wiki to the list of wikis served.

    Rather than mess around with parsing html in node I am going to have this
    parse the html file into tiddlers in the browser and then send them to this
    message. This also means that this can be used to make a wiki out of a sub-set of tiddlers from an existing wiki, or from different wikis.
    TODO make this keep track of where the original wiki is so we can overwrite
    the original wiki when saving this one.

    inputs:
    data.filePath - the path to the single file html wiki to split up.
    data.wikisPath - the path to where the node wiki should be saved.
    data.wikiFolder - the folder to hold the wikis
    data.wikiName - the name to give the node version of the wiki
  */
  $tw.nodeMessageHandlers.newWikiFromTiddlers = function (data) {
    // Do nothing unless there is an input file path given
//    if (data.filePath) {
    if (data.tiddlers) {
      var path = require('path');
      var fs = require('fs')
      var wikiName, wikiTiddlersPath, basePath;
      var wikiFolder = data.wikiFolder || "Wikis";
      // If there is no wikiname given create one
      if (data.wikiName) {
        // If a name is given use it
        wikiName = GetWikiName(data.wikiName, 0);
      } else {
        // Otherwise create a new wikiname
        wikiName = GetWikiName("NewWiki", 0);
      }
      // If there is no output path given use a default one
      if (data.wikisPath) {
        basePath = data.wikisPath;
      } else {
        basePath = process.pkg?path.dirname(process.argv[0]):process.cwd();
      }

      // First copy the empty edition to the wikiPath to make the
      // tiddlywiki.info
      var params = {"wiki": "", "basePath": basePath, "wikisFolder": wikiFolder, "edition": "empty", "path": wikiName, "wikiName": wikiName};
      $tw.nodeMessageHandlers.createNewWiki(params);
      // Get the folder for the wiki tiddlers
      wikiTiddlersPath = path.join(basePath, wikiFolder, wikiName, 'tiddlers');
      // Make sure tiddlers folder exists
      try {
        fs.mkdirSync(wikiTiddlersPath);
        console.log('Created Tiddlers Folder ', wikiTiddlersPath);
      } catch (e) {
        console.log('Tiddlers Folder Exists');
      }
      // Then split the wiki into separate tidders
      //var tiddlers = $tw.loadTiddlersFromFile(data.filePath),
      var count = 0;
      $tw.utils.each(data.tiddlers,function(tiddler) {
        // Save each tiddler in the correct folder
        // Get the tiddler file title
        var tiddlerFileName = $tw.syncadaptor.generateTiddlerBaseFilepath(tiddler.title);
        // Output file name
        var outputFile = path.join(wikiTiddlersPath, tiddlerFileName);
        var options = {
          "currentTiddler": tiddler.title
        };
        var text = $tw.wiki.renderTiddler('text/plain','$:/core/templates/tid-tiddler', options);
        // Save each tiddler as a file in the appropriate place
        fs.writeFile(outputFile,text,"utf8",function(err) {
          if (err) {
            console.log(err);
          }
        });
        count++;
      });
      if(!count) {
        console.log("No tiddlers found in the input file");
      } else {
        // Add the new wiki to the list of served wikis
        // TODO this!!
      }
    } else {
      console.log('No path given!');
    }
  }

  /*
    This ensures that the wikiName used is unique by appending a number to the
    end of the name and incrementing the number if needed until an unused name
    is created.
  */
  function GetWikiName (wikiName, count) {
    var updatedName;
    // If the wikiName is usused than return it
    if (!$tw.settings.wikis[wikiName]) {
      return wikiName;
    } else {
      // Try the next name and recurse
      if (wikiName.endsWith(count)) {
        // If the name ends in a number increment it
        wikiName = wikiName.slice(0, -1*String(count).length);
        count = Number(count) + 1;
        updatedName = wikiName + String(count);
      } else {
        // If the name doesn't end in a number than add a 1 to start out.
        count = Number(count) + 1;
        updatedName = wikiName + String(count);
      }
      return GetWikiName(updatedName, count);
    }
  }

  // This is just a copy of the init command modified to work in this context
  $tw.nodeMessageHandlers.createNewWiki = function (data) {
    if (data.wiki === 'RootWiki') {
      var fs = require("fs"),
        path = require("path");

      function specialCopy (source, destination) {
        fs.mkdirSync(destination);
        var currentDir = fs.readdirSync(source)
        currentDir.forEach(function (item) {
          if (fs.statSync(path.join(source, item)).isFile()) {
            var fd = fs.readFileSync(path.join(source, item), {encoding: 'utf8'});
            fs.writeFileSync(path.join(destination, item), fd, {encoding: 'utf8'});
          } else {
            //Recurse!! Because it is a folder.
            // But make sure it is a directory first.
            if (fs.statSync(path.join(source, item)).isDirectory()) {
              specialCopy(path.join(source, item), path.join(destination, item));
            }
          }
        });
      }

      // Paths are relative to the root wiki path
      if (process.pkg) {
        // This is for handling when it is a single executable
        // Base path is where the executable is by default
        data.basePath = data.basePath || path.dirname(process.argv[0]);
        data.wikisFolder = data.wikisFolder || 'Wikis';
      }
      data.wikisFolder = data.wikisFolder || '';
      // If no basepath is given than the default is to make the folder a
      // sibling of the index wiki folder
      var basePath = data.basePath || path.join($tw.boot.wikiPath, '..')

      try {
        fs.mkdirSync(path.join(basePath, data.wikisFolder));
        console.log('Created Wikis Folder');
      } catch (e) {
        console.log('Wikis Folder Exists');
      }
      // This is the path given by the person making the wiki, it needs to be
      // relative to the basePath
      // data.wikisFolder is an optional sub-folder to use. If it is set to
      // Wikis than wikis created will be in the basepath/Wikis/relativePath
      // folder
      // I need better names here.
      var relativePath = path.join(data.wikisFolder, data.path);
      var fullPath = path.join(basePath, relativePath)
      var tiddlersPath = path.join(fullPath, 'tiddlers')
      // For now we only support creating wikis with one edition, multi edition
      // things like in the normal init command can come later.
      var editionName = data.edition?data.edition:"empty";
      var searchPaths = $tw.getLibraryItemSearchPaths($tw.config.editionsPath,$tw.config.editionsEnvVar);
      if (process.pkg) {
        var editionPath = undefined
        var pluginPath = process.pkg.path.resolve("./editions","./" + editionName)
        if(true || fs.existsSync(pluginPath) && fs.statSync(pluginPath).isDirectory()) {
          editionPath = pluginPath;
        }
        if (editionPath) {
          specialCopy(editionPath, fullPath);
          console.log("Copied edition '" + editionName + "' to " + fullPath + "\n");
        } else {
          console.log("Edition not found");
        }
      } else {
        // Check the edition exists
        var editionPath = $tw.findLibraryItem(editionName,searchPaths);
        if(!$tw.utils.isDirectory(editionPath)) {
          console.log("Edition '" + editionName + "' not found");
        }
        // Copy the edition content
        var err = $tw.utils.copyDirectory(editionPath,fullPath);
        if(!err) {
          console.log("Copied edition '" + editionName + "' to " + fullPath + "\n");
        } else {
          console.log(err);
        }
      }
      // Tweak the tiddlywiki.info to remove any included wikis
      var packagePath = path.join(fullPath, "tiddlywiki.info");
      var packageJson = JSON.parse(fs.readFileSync(packagePath));
      delete packageJson.includeWikis;
      fs.writeFileSync(packagePath,JSON.stringify(packageJson,null,$tw.config.preferences.jsonSpaces));

      // We need to make sure that the wikis entry is in the root settings
      // thing.
      var tidText = {};
      var tiddler = $tw.wiki.getTiddler('{RootWiki}$:/WikiSettings/split');
      if (tiddler) {
        if (typeof tiddler.fields.text === 'object') {
          // Clone object to make it writable
          tidText = JSON.parse(JSON.stringify(tiddler.fields.text));
        } else {
          tidText = JSON.parse(tiddler.fields.text);
        }
      }
      tidText['wikis'] = tidText['wikis'] || '$:/WikiSettings/split/wikis';

      $tw.wiki.addTiddler(new $tw.Tiddler({title:'{RootWiki}$:/WikiSettings/split', text:tidText, type: 'application/json'}));
      $tw.Bob.SendToBrowsers({type: 'saveTiddler', tiddler: {fields: {title:'$:/WikiSettings/split', text:JSON.stringify(tidText, "", $tw.config.preferences.jsonSpaces), type: 'application/json'}}, wiki: 'RootWiki'});

      var tiddlerText = $tw.wiki.getTiddlerText('{RootWiki}$:/WikiSettings/split/wikis')

      tiddlerText = tiddlerText?tiddlerText:"{}";
      var currentWikis = JSON.parse(tiddlerText);
      // Get desired name for the new wiki
      var name = data.wikiName || 'newWiki';
      // Make sure we have a unique name by appending a number to the wiki name
      // if it exists.
      if (currentWikis[name]) {
        var i = 0;
        var newName = name;
        while (currentWikis[newName]) {
          i = i + 1;
          newName = name + i;
        }
        name = name + i;
      }

      // Use relative paths here.
      // Note this that is dependent on process.cwd()!!
      var rootPath = process.pkg?path.dirname(process.argv[0]):process.cwd();
      currentWikis[name] = '.' + path.sep + path.relative(rootPath, fullPath);

      var tiddlerFields = {
        title: '{RootWiki}$:/WikiSettings/split/wikis',
        text: JSON.stringify(currentWikis, null, $tw.config.preferences.jsonSpaces),
        type: 'application/json'
      };
      // Add the tiddler
      $tw.wiki.addTiddler(new $tw.Tiddler(tiddlerFields));
      // Push changes out to the browsers
      var tiddlerFields2 = {
        title: '$:/WikiSettings/split/wikis',
        text: JSON.stringify(currentWikis, null, $tw.config.preferences.jsonSpaces),
        type: 'application/json'
      };
      $tw.Bob.SendToBrowsers({type: 'saveTiddler', tiddler: {fields: tiddlerFields2}, wiki: 'RootWiki'});

      $tw.nodeMessageHandlers.saveSettings({wiki: 'RootWiki'});

      // This is here as a hook for an external server. It is defined by the
      // external server and shouldn't be defined here or it will break
      // If you are not using an external server than this does nothing
      if (typeof $tw.ExternalServer.initialiseWikiSettings === 'function') {
        $tw.ExternalServer.initialiseWikiSettings(name, data);
      }

      // Then clear all the routes to the non-root wiki
      $tw.httpServer.clearRoutes();
      // The re-add all the routes from the settings
      // This reads the settings so we don't need to give it any arguments
      $tw.httpServer.addOtherRoutes();
    }
  }

  /*
    This unloads a wiki from memory.
    This can be used to reduce the memory footprint and to fully reload a wiki.

    It needs to remove everything under $tw.Bob.Wikis[data.wikiName] for the
    wiki. And it also need to find all of the tiddlers for the wiki and remove
    them. But I don't know how to do that without deleting the tiddlers.
  */
  $tw.nodeMessageHandlers.unloadWiki = function (data) {
    console.log('Unload wiki ', data.wikiName)
    // make sure that there is a wiki name given.
    if (data.wikiName) {
      // Make sure that the wiki is loaded
      if ($tw.Bob.Wikis[data.wikiName]) {
        if ($tw.Bob.Wikis[data.wikiName].State === 'loaded') {
          // If so than unload the wiki
          // Get the list of tiddlers for this wiki
          $tw.wiki.allTitles().filter(function(title) {
            return title.startsWith('{' + data.wikiName + '}');
          }).forEach(function(title) {
            // Remove all the tiddlers listed as being in the wiki from
            // the internal listing.
            $tw.wiki.deleteTiddler(title);
          })
          // This removes the information about the wiki
          delete $tw.Bob.Wikis[data.wikiName];
        }
      }
    }
  }

  /*
    This handles ack messages.
  */
  $tw.nodeMessageHandlers.ack = $tw.Bob.Shared.handleAck;

}
})()
