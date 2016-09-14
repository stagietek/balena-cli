
/*
Copyright 2016 Resin.io

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
 */

(function() {
  var commandOptions, stepHandler;

  commandOptions = require('./command-options');

  exports.download = {
    signature: 'os download <type>',
    description: 'download an unconfigured os image',
    help: 'Use this command to download an unconfigured os image for a certain device type.\n\nExamples:\n\n	$ resin os download parallella -o ../foo/bar/parallella.img',
    permission: 'user',
    options: [
      {
        signature: 'output',
        description: 'output path',
        parameter: 'output',
        alias: 'o',
        required: 'You have to specify an output location'
      }
    ],
    action: function(params, options, done) {
      var fs, manager, rindle, unzip, visuals;
      unzip = require('unzip2');
      fs = require('fs');
      rindle = require('rindle');
      manager = require('resin-image-manager');
      visuals = require('resin-cli-visuals');
      console.info("Getting device operating system for " + params.type);
      return manager.get(params.type).then(function(stream) {
        var bar, output, spinner;
        bar = new visuals.Progress('Downloading Device OS');
        spinner = new visuals.Spinner('Downloading Device OS (size unknown)');
        stream.on('progress', function(state) {
          if (state != null) {
            return bar.update(state);
          } else {
            return spinner.start();
          }
        });
        stream.on('end', function() {
          return spinner.stop();
        });
        if (stream.mime === 'application/zip') {
          output = unzip.Extract({
            path: options.output
          });
        } else {
          output = fs.createWriteStream(options.output);
        }
        return rindle.wait(stream.pipe(output))["return"](options.output);
      }).tap(function(output) {
        return console.info('The image was downloaded successfully');
      }).nodeify(done);
    }
  };

  stepHandler = function(step) {
    var _, bar, helpers, rindle, visuals;
    _ = require('lodash');
    rindle = require('rindle');
    visuals = require('resin-cli-visuals');
    helpers = require('../utils/helpers');
    step.on('stdout', _.bind(process.stdout.write, process.stdout));
    step.on('stderr', _.bind(process.stderr.write, process.stderr));
    step.on('state', function(state) {
      if (state.operation.command === 'burn') {
        return;
      }
      return console.log(helpers.stateToString(state));
    });
    bar = new visuals.Progress('Writing Device OS');
    step.on('burn', _.bind(bar.update, bar));
    return rindle.wait(step);
  };

  exports.configure = {
    signature: 'os configure <image> <uuid>',
    description: 'configure an os image',
    help: 'Use this command to configure a previously download operating system image with a device.\n\nExamples:\n\n	$ resin os configure ../path/rpi.img 7cf02a6',
    permission: 'user',
    options: [
      {
        signature: 'advanced',
        description: 'show advanced commands',
        boolean: true,
        alias: 'v'
      }
    ],
    action: function(params, options, done) {
      var _, form, helpers, init, resin;
      _ = require('lodash');
      resin = require('resin-sdk');
      form = require('resin-cli-form');
      init = require('resin-device-init');
      helpers = require('../utils/helpers');
      console.info('Configuring operating system image');
      return resin.models.device.get(params.uuid).then(function(device) {
        return helpers.getManifest(params.image, device.device_type).get('options').then(function(questions) {
          var advancedGroup, override;
          if (!options.advanced) {
            advancedGroup = _.findWhere(questions, {
              name: 'advanced',
              isGroup: true
            });
            if (advancedGroup != null) {
              override = helpers.getGroupDefaults(advancedGroup);
            }
          }
          return form.run(questions, {
            override: override
          });
        }).then(function(answers) {
          return init.configure(params.image, params.uuid, answers).then(stepHandler);
        });
      }).nodeify(done);
    }
  };

  exports.initialize = {
    signature: 'os initialize <image>',
    description: 'initialize an os image',
    help: 'Use this command to initialize a previously configured operating system image.\n\nExamples:\n\n	$ resin os initialize ../path/rpi.img --type \'raspberry-pi\'',
    permission: 'user',
    options: [
      commandOptions.yes, {
        signature: 'type',
        description: 'device type',
        parameter: 'type',
        alias: 't',
        required: 'You have to specify a device type'
      }, {
        signature: 'drive',
        description: 'drive',
        parameter: 'drive',
        alias: 'd'
      }
    ],
    root: true,
    action: function(params, options, done) {
      var Promise, form, helpers, init, patterns, umount;
      Promise = require('bluebird');
      umount = Promise.promisifyAll(require('umount'));
      form = require('resin-cli-form');
      init = require('resin-device-init');
      patterns = require('../utils/patterns');
      helpers = require('../utils/helpers');
      console.info('Initializing device');
      return helpers.getManifest(params.image, options.type).then(function(manifest) {
        var ref;
        return (ref = manifest.initialization) != null ? ref.options : void 0;
      }).then(function(questions) {
        return form.run(questions, {
          override: {
            drive: options.drive
          }
        });
      }).tap(function(answers) {
        var message;
        if (answers.drive == null) {
          return;
        }
        message = "This will erase " + answers.drive + ". Are you sure?";
        return patterns.confirm(options.yes, message)["return"](answers.drive).then(umount.umountAsync);
      }).tap(function(answers) {
        return init.initialize(params.image, options.type, answers).then(stepHandler);
      }).then(function(answers) {
        if (answers.drive == null) {
          return;
        }
        return umount.umountAsync(answers.drive).tap(function() {
          return console.info("You can safely remove " + answers.drive + " now");
        });
      }).nodeify(done);
    }
  };

}).call(this);
