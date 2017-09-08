window.AudioContext = window.AudioContext || window.webkitAudioContext;

$(function () {
	$.getJSON('files/urinetown.json').done(function (data) {
		playData = data;
		initializeSelects();
	});

	var playData;
	var playing = false;

	var loadedScenes = [];

	var context = new AudioContext();

	var promptBuffer;
	$.ajax('files/prompt.mp3', {dataType: 'arraybuffer', processData: false}).done(function (data) {
		context.decodeAudioData(data, function (buffer) {
			promptBuffer = buffer;
		}, function () {});
	});

	var currentCharacter;
	var currentScene;
	var currentLine = 0;

	var nextTimeout;

	var transcriptElements = [];

	var recognition = new webkitSpeechRecognition();
	recognition.continuous = true;
	recognition.interimResults = true;
	recognition.dialect = 'en-US';

	var lastSource;

	var initializeSelects = function () {
		for (var i = 0; i < playData.scenes.length; i++) {
			$('#sceneSelector').append(
				$('<option></option>').attr('value', i).text(playData.scenes[i].name)
			);
			loadedScenes.push(undefined);
		}

		for (var i = 0; i < playData.characters.length; i++) {
			$('#characterSelector').append(
				$('<option></option>').attr('value', i).text(playData.characters[i])
			);
		}
	}

	var currentlyLoading = 0;

	$('#sceneSelector').change(function () {
		if (playing) {
			pause();
		}

		var val = $(this).val();

		if (val === '') {
			$('#playPauseButton').addClass('disabled');
		} else {
			var newSceneId = parseInt(val);

			if (loadedScenes[newSceneId] === undefined) {
				$('#playPauseButton').addClass('disabled');

				var metaPromise = $.getJSON(playData.scenes[newSceneId].meta);
				var mp3Promise = $.ajax(playData.scenes[newSceneId].audio, {dataType: 'arraybuffer', processData: false});
				currentlyLoading++;

				$.when(metaPromise, mp3Promise).then(function (metaArgs, mp3Args) {
					context.decodeAudioData(mp3Args[0], function (buffer) {
						currentlyLoading--;
						loadedScenes[newSceneId] = {"meta": metaArgs[0], "audioBuffer": buffer};
						if (currentlyLoading === 0) {
							$('#playPauseButton').removeClass('disabled');
						}
						initializeScene(newSceneId);
					}, function () {});
				});
			} else {
				if (currentlyLoading === 0) {
					$('#playPauseButton').removeClass('disabled');
				}
				initializeScene(newSceneId);
			}
		}
	});

	$('#characterSelector').change(function () {
		if (playing) {
			pause();
		}

		var newCharId = parseInt($(this).val());

		if (newCharId === '') {
			$('#playPauseButton').addClass('disabled');
		} else {
			currentCharacter = newCharId;
		}
	});

	var speakLine = function (scene, lineIndex) {
		if (lastSource) {
			lastSource.stop();
		}
		var source = context.createBufferSource();
		source.buffer = loadedScenes[scene].audioBuffer;
		source.connect(context.destination);
		source.start(context.currentTime, loadedScenes[scene].meta.lines[lineIndex].startTime, loadedScenes[scene].meta.lines[lineIndex].length + .1);
		lastSource = source;
	};

	var initializeScene = function (sceneId) {
		currentScene = sceneId;

		$('#transcript, #previousLine, #currentLine').html('');
		transcriptElements = [];

		for (var i = 0; i < loadedScenes[sceneId].meta.lines.length; i++) {
			var line = loadedScenes[sceneId].meta.lines[i];
			var transcriptDiv = $('<div>');
			transcriptDiv.text(characterDisplay(line.characters) + ": " + line.line);

			(function (i) {
				transcriptDiv.click(function () {
					if (playing) {
						pause();
					}
					changeLine(i);
				});
			})(i);

			transcriptElements.push(transcriptDiv);
			$('#transcript').append(transcriptDiv);
		}

		currentLine = 0;
	};

	var characterDisplay = function (characterArray) {		// assumes there is no overlap in classes
															// sort of yagni and it doesn't even solve the 100% general case lol
		var nameArray = [];
		var trimmableArray = characterArray.slice();
		for (var className in playData.characterClasses) {
			var allCharacters = true;
			for (var i = 0; i < playData.characterClasses[className].length; i++) {
				if (trimmableArray.indexOf(playData.characterClasses[className][i]) === -1) {
					allCharacters = false;
					break;
				}
			}
			if (allCharacters) {
				nameArray.push(className);
				trimmableArray = trimmableArray.filter(function (id) {
					return playData.characterClasses[className].indexOf(id) === -1;
				});
			}
		}

		for (var i = 0; i < trimmableArray.length; i++) {
			nameArray.push(playData.characters[trimmableArray[i]]);
		}

		return nameArray.join('/');
	};

	var changeLine = function (line) {
		currentLine = line;

		$('#transcript div').removeClass('highlight');
		if (transcriptElements[line]) {
			transcriptElements[line].addClass('highlight');
			if (line === 0) {
				$('#transcript').scrollTop(0);
			} else {
				$('#transcript').scrollTop($('.highlight').prev().position().top - 10);
			}
		}
	}

	var play = function () {
		$('#playPauseButton').text('Pause');
		playing = true;

		setupLine(currentLine);
	};

	var setupLine = function (line) {
		if (!playing) {
			return;
		}

		if (loadedScenes[currentScene].meta.lines[line] === undefined) {
			return;
		}

		if (line !== 0) {			
			$('#previousLine').text(
				characterDisplay(loadedScenes[currentScene].meta.lines[line - 1].characters) + ": " + loadedScenes[currentScene].meta.lines[line - 1].line
			);
		} else {
			$('#previousLine').text('');
		}

		if (loadedScenes[currentScene].meta.lines[line].characters.indexOf(currentCharacter) !== -1) {
			showButtons();
			if (promptBuffer && $('#promptSoundCheck').is(':checked')) {
				playPrompt();
			}
			beginRecognition(loadedScenes[currentScene].meta.lines[line].line);
		} else {
			hideButtons();
			$('#currentLine').text(
				characterDisplay(loadedScenes[currentScene].meta.lines[line].characters) + ": " + loadedScenes[currentScene].meta.lines[line].line
			);
			speakLine(currentScene, line);
			nextTimeout = window.setTimeout(function () {
				changeLine(currentLine + 1);
				console.log(3);
				setupLine(currentLine);
			}, (loadedScenes[currentScene].meta.lines[line].length + .3) * 1000);
		}
	};

	var playPrompt = function () {
		var source = context.createBufferSource();
		source.buffer = promptBuffer;
		source.connect(context.destination);
		source.start(context.currentTime);
	};

	var beginRecognition = function (line) {
		recognition.stop();
		$('#currentLine').text('');

		var scriptBits = line.split(' ');
		var easyBits = line.split(' ').map(function (t) {
			return t.toLowerCase().replace(/[^a-z]/g, '').replace('whaa', 'wha');
		});
		var easyString = easyBits.join(' ');
		var recognitionTranscript = '';

		var lastTimeout;
		var recognizing;

		var parse = function(ts) {
			var diff = JsDiff.diffChars(easyString, ts);

			var currentArray = [];
			for (var i = 0; i < easyBits.length; i++)
				currentArray.push(0);

			var fullSame = ''

			diff.forEach(function (part) {
				if (!part.added && !part.removed) {
					fullSame += part.value;
				}
			});
			var sameParts = fullSame.split(' ');
			var currentSamePart = 0;
			for (var i = 0; i < easyBits.length; i++) {
				if (easyBits[i] === sameParts[currentSamePart]) {
					currentArray[i] = 1;
					currentSamePart++;
				} else {
					var everAppears = false;
					for (var j = i; j < easyBits.length; j++) {
						if (easyBits[j] === sameParts[currentSamePart]) {
							everAppears = true;
							break;
						}
					}
					currentArray[i] = -1;
					if (!everAppears) {
						currentSamePart++;
					}
				}
			}
			for (var i = currentArray.length - 1; i >= 0; i--) {
				if (currentArray[i] === -1) {
					currentArray[i] = 0;
				} else {
					break;
				}
			}

			var builtString = '';
			var successRate = 0;
			var finished = true;
			for (var i = 0; i < currentArray.length; i++) {
				if (currentArray[i] === 1) {
					builtString += '<span style="color: black;">' + scriptBits[i] + '</span> ';
					successRate += 1.0 / currentArray.length;
				} else if (currentArray[i] === -1) {
					builtString += '<span style="color: red;">' + scriptBits[i] + '</span> ';
				} else if (currentArray[i] === 0) {
					finished = false;
					break;
				}
			}
			return [builtString, successRate, finished];
		};

		recognition.onresult = function(event) {
			var results = event.results;
			window.clearTimeout(lastTimeout);

			recognitionTranscript = '';

			for (var i = 0; i < results.length; i++) {
				if (results[i][0].confidence > .8 || results[i].isFinal)
					recognitionTranscript += results[i][0].transcript;
			}

			recognitionTranscript = recognitionTranscript.toLowerCase();
			var parsedTranscript = parse(recognitionTranscript);
			$('#currentLine').html(parsedTranscript[0]);
			if (parsedTranscript[2] && parsedTranscript[1] > .8) {
				if (recognizing) {
					recognizing = false;
					recognition.stop();
					recognition.onend = function () {
						changeLine(currentLine + 1);
						console.log(1);
						setupLine(currentLine);
					};
				}
			} else if (parsedTranscript[1] > .8) {
				lastTimeout = window.setTimeout(function () {
					if (recognizing) {
						recognizing = false;
						recognition.stop();
						recognition.onend = function () {
							changeLine(currentLine + 1);
							console.log(2);
							setupLine(currentLine);
						};
					}
				}, 3000);
			}
		};

		$('#currentLineSkipButton').click(function () {
			recognition.stop();
			recognizing = false;
			recognition.onend = function () {
				changeLine(currentLine + 1);
				console.log(4);
				setupLine(currentLine);
			};
		});

		$('#currentLineRestartButton').click(function () {
			recognition.stop();
			recognizing = false;
			recognition.onend = function () {
				setupLine(currentLine);
			};
		});

		recognition.start();
		recognizing = true;
	};

	var pause = function () {
		$('#playPauseButton').text('Play');
		if (lastSource) {
			lastSource.stop();
		}
		playing = false;
		hideButtons();
		recognition.stop();

		if (nextTimeout) {
			window.clearTimeout(nextTimeout);
		}
	};

	var showButtons = function () {
		$('#previousLineRestartButton, #currentLineRestartButton, #currentLineSkipButton').show();
	};

	var hideButtons = function () {
		$('#previousLineRestartButton, #currentLineRestartButton, #currentLineSkipButton').hide();
	};

	$('#previousLineRestartButton').click(function () {
		if (currentLine !== 0) {
			speakLine(currentScene, currentLine - 1);
		}
	});

	$('#playPauseButton').click(function () {
		if (!$(this).hasClass('disabled')) {
			if (playing) {
				pause();
			} else {
				play();
			}
		}
	});

	$('#transcriptCollapseButton').click(function () {
		if ($('#transcript').is(':visible')) {
			$('#transcript').hide();
			$(this).text('+');
		} else {
			$('#transcript').show();
			$(this).text('-');
		}
	});
});