/*global $, sc, ace, js_beautify, AudioPlayer, Worker */
(function (global) {
	'use strict';

	var AudioSort = {},
		// Pass jshint
		Fn = Function,
		// Default Settings
		defaults = {
			volume: { value: 0.25, min: 0, max: 1, step: 0.01 },
			tempo: { value: 120, min: 20, max: 300, step: 1 },
			centerNote: { value: 69, min: 0, max: 127, step: 1 },
			scale: { value: 'chromatic' },
			sort: { value: 'bubble' },
			dataSize: { value: 25, min: 4, max: 48, step: 1 }
		},
		// Currently Selected Items
		selected = {
			volume: defaults.volume.value,
			tempo: defaults.tempo.value,
			centerNote: defaults.centerNote.value,
			scale: defaults.scale.value,
			sort: defaults.sort.value,
			dataSize: defaults.dataSize.value
		},
		// Audio players
		players = {
			base: null,
			sort: null
		},
		// Audio Variables
		env,
		pluck,
		// Ace Editor
		aceEditor,
		// Helper Variables
		displayCache = {},
		baseData = [],
		maxData = [],
		// Web Workers
		worker = null,
		workerKey,
		workerUrl = 'dist/worker.min.js',
		workerOnMessage,
		workerOnError,
		// Functions
		addAceEditor,
		onSaveAlgorithmEdit,
		onSaveAlgorithmNew,
		buildSortOptions,
		clickPlayButton,
		doSort,
		getBaseDataAsFrames,
		getBaseDataAsPlayableObjects,
		getNoteName,
		getSortedScaleNames,
		getTempoString,
		onAudioDataButton,
		onScaleChange,
		onSlider,
		onSliderCenterNote,
		onSliderDataSize,
		onSliderTempo,
		onSliderVolume,
		onSortOptionSelected,
		onSortModalClick,
		onAddAlgorithmModalClick,
		populateSelect,
		setupPlayers,
		updateDisplayCache;

	buildSortOptions = function (selector) {
		var $container, $li, $a, sortKey, sortObject;
		if (global.hasOwnProperty('sort')) {
			$container = $(selector);
			$container.empty();
			for (sortKey in global.sort) {
				if (global.sort.hasOwnProperty(sortKey)) {
					sortObject = global.sort[sortKey];
					$li = $('<li></li>');
					$a = $('<a href="javascript:void(0);"></a>');
					$a.attr('data-sort', sortKey);
					$a.text(sortObject.display);
					$li.append($a);
					$container.append($li);
				}
			}
		}
	};
	
	getBaseDataAsPlayableObjects = function (playIndex) {
		var i, objectArray = [];
		// convert baseData to an array of drawable/playable objects
		for (i = 0; i < baseData.length; i++) {
			objectArray.push({
				value: baseData[i],
				play: i === playIndex,
				mark: false,
				swap: false,
				justSwapped: false,
				compare: false,
				highlight: false
			});
		}
		return objectArray;
	};

	getBaseDataAsFrames = function () {
		var i, frameArray = [];

		// convert to "frame data"
		for (i = 0; i < baseData.length; i++) {
			frameArray.push({
				arr: getBaseDataAsPlayableObjects(i),
				compareCount: 0,
				swapCount: 0
			});
		}
		return frameArray;
	};

	clickPlayButton = function () {
		$('#sort-player .btn[data-action="play"]').click();
	};

	getNoteName = function (midiNumber) {
		var notes = ['c','c#','d','d#','e','f','f#','g','g#','a','a#','b'],
			len = notes.length,
			octave = Math.floor(midiNumber / len) - 1,
			idx = midiNumber % len,
			note = notes[idx];
		return '(' + note.charAt(0) + octave + note.charAt(1) + ') ' + midiNumber;
	};

	updateDisplayCache = function (selector, value, fnFormat) {
		if (!displayCache.hasOwnProperty(selector)) {
			displayCache[selector] = $(selector);
		}
		if (typeof fnFormat === 'function') {
			value = fnFormat(value);
		}
		displayCache[selector].text(value);
	};

	onSlider = function (key, selector, event, fnFormat) {
		if (event) {
			selected[key] = event.value;
		}
		updateDisplayCache(selector, selected[key], fnFormat);
	};

	onSliderVolume = function (e) {
		onSlider('volume', '#volume-display', e, function (val) {
			return val.toFixed(2);
		});
		players.base.setVolume(selected.volume);
		players.sort.setVolume(selected.volume);
	};

	onSliderTempo = function (e) {
		var tempo = getTempoString();
		onSlider('tempo', '#tempo-display', e);
		players.base.setTempo(tempo);
		players.sort.setTempo(tempo);
	};

	onSliderCenterNote = function (e) {
		onSlider('centerNote', '#center-note-display', e, getNoteName);
	};

	onSliderDataSize = function (e) {
		onSlider('dataSize', '#data-size-display', e);
		baseData = maxData.slice(0, selected.dataSize);
		players.base.setData(getBaseDataAsFrames());
		doSort();
	};

	onScaleChange = function (e) {
		selected.scale = e.target.value;
	};

	onAudioDataButton = function () {
		var action = $(this).data('action');
		if (global.fn.datagen.hasOwnProperty(action)) {
			baseData = global.fn.datagen[action](selected.dataSize);
			players.base.setData(getBaseDataAsFrames());
			players.base.goToFirst();
			if (players.base.isPlaying()) {
				players.base.play();
			}
			doSort();
		}
	};

	onSortOptionSelected = function () {
		var $item = $(this),
			$parent = $item.parent();
		if ($item.hasClass('disabled')) {
			return;
		}
		$parent.find('li').removeClass('active');
		$item.addClass('active');
		updateDisplayCache('#sort-display', $item.text());
		selected.sort = $item.find('a').data('sort');
		doSort();
	};
	
	addAceEditor = function (container) {
		var $container = $(container),
			id = 'id_' + (new Date()).getTime();
		$container.empty().append('<div class="js-editor" id="' + id + '"></div>');
		aceEditor = ace.edit(id);
		aceEditor.setTheme('ace/theme/monokai');
		aceEditor.getSession().setMode('ace/mode/javascript');
		aceEditor.getSession().on('changeAnnotation', function () {
			var i,
				annotation,
				annotationsOld = aceEditor.getSession().getAnnotations(),
				annotationsNew = [],
				changed = false;
			for (i = 0; i < annotationsOld.length; i++) {
				annotation = annotationsOld[i];
				if (annotation.text === "'AS' is not defined.") {
					changed = true;
				} else {
					annotationsNew.push(annotation);
				}
			}
			if (changed) {
				aceEditor.getSession().setAnnotations(annotationsNew);
			}
		});
	};

	onSortModalClick = function () {
		var $modal = $('#sort-modal'),
			selectedSort = global.sort[selected.sort],
			fnArray,
			fnText;
		$modal.find('.sort-name').text(selectedSort.display);
		$modal.find('.nav-tabs a:first').tab('show');
		$modal.find('#sort-info-display').html(selectedSort.display || '&nbsp;');
		$modal.find('#sort-info-stable').html(selectedSort.stable ? 'Yes' : 'No');
		$modal.find('#sort-info-best').html(selectedSort.best || '&nbsp;');
		$modal.find('#sort-info-average').html(selectedSort.average || '&nbsp;');
		$modal.find('#sort-info-worst').html(selectedSort.worst || '&nbsp;');
		$modal.find('#sort-info-memory').html(selectedSort.memory || '&nbsp;');
		$modal.find('#sort-info-method').html(selectedSort.method || '&nbsp;');
		addAceEditor('#sort-algorithm');
		fnArray = $.trim(selectedSort.toString()).split('\n');
		fnText = fnArray.splice(1, fnArray.length - 2).join('\n');
		fnText = js_beautify(fnText, {
			indent_size: 1,
			indent_char: '\t'
		});
		aceEditor.setValue(fnText);
		aceEditor.clearSelection();
		$modal.modal();
	};

	onSaveAlgorithmEdit = function () {
		global.sort[selected.sort] = new Fn(aceEditor.getValue());
		$('#sort-modal').modal('hide');
	};

	onSaveAlgorithmNew = function () {
		var name = $('#new-sort-name').val(),
			nameSafe = name.replace(/[^a-zA-Z]/gi, ''),
			id = nameSafe + '_id_' + (new Date()).getTime();
		if ($.trim(name).length) {
			global.sort[id] = new Fn(aceEditor.getValue());
			global.sort[id].display = name;
			global.sort[id].stable = true;
			global.sort[id].best = '';
			global.sort[id].average = '';
			global.sort[id].worst = '';
			global.sort[id].memory = '';
			global.sort[id].method = '';
		}
		$('#add-algorithm-modal').modal('hide');
		buildSortOptions('#sort-options');
	};

	onAddAlgorithmModalClick = function () {
		var $modal = $('#add-algorithm-modal');
		$modal.find('#new-sort-name').val('');
		addAceEditor('#new-sort-algorithm');
		$modal.modal();
	};

	getTempoString = function () {
		return 'bpm' + (parseFloat(selected.tempo) || 120) + ' l16';
	};

	setupPlayers = function () {
		players.base = AudioPlayer.create('#base-section', {
			env: env,
			pluck: pluck,
			isLooping: true,
			hasMarkers: false,
			onPlayerButtonClickCallback: function (e) {
				if (e.action !== 'loop') {
					players.sort.stop();
				}
			}
		});
		players.sort = AudioPlayer.create('#sort-section', {
			env: env,
			pluck: pluck,
			isLooping: false,
			hasMarkers: true,
			onPlayerButtonClickCallback: function (e) {
				if (e.action !== 'loop') {
					players.base.stop();
				}
			}
		});
	};

	getSortedScaleNames = function () {
		var names = sc.ScaleInfo.names().sort(function (o1, o2) {
			var ret = 0,
				s1 = sc.ScaleInfo.at(o1),
				s2 = sc.ScaleInfo.at(o2);
			ret = s1.pitchesPerOctave() - s2.pitchesPerOctave();
			if (ret === 0) {
				ret = s1.degrees().length - s2.degrees().length;
				if (ret === 0) {
					ret = s1.name.localeCompare(s2.name);
				}
			}
			return ret;
		});
		return names;
	};

	populateSelect = function (originalSelector, chosenSelector, fnOnScaleChange) {
		var currentKey, lastKey, scale, scaleNames,
			numPitches, numDegrees,
			$select, $optgroup, $option;

		$select = $(originalSelector);
		scaleNames = getSortedScaleNames();
		$.each(scaleNames, function (index, scaleName) {
			// loop variables
			scale = sc.ScaleInfo.at(scaleName);
			numPitches = scale.pitchesPerOctave();
			numDegrees = scale.degrees().length;
			currentKey = numPitches + '_' + numDegrees;
			// setup optgroup
			if (currentKey !== lastKey) {
				if (lastKey) {
					$select.append($optgroup);
				}
				lastKey = currentKey;
				$optgroup = $('<optgroup />')
					.attr('label', 'Octave: ' + numPitches + ' / Notes: ' + numDegrees);
			}
			// add option
			$option = $('<option />')
				.val(scaleName)
				.text(scale.name);
			// make sure default item is selected
			if (selected.scale === scaleName) {
				$option.attr('selected', 'selected');
			}
			$optgroup.append($option);
		});
		$select.append($optgroup);
		$(originalSelector).chosen().change(fnOnScaleChange);
		$(chosenSelector).width('100%');
	};

	workerOnMessage = function (event) {
		var isSortPlaying = players.sort.isPlaying();
		if (event.data.key === workerKey) {
			players.sort.setData(event.data.frames || []);
			players.sort.goToFirst();
			if (isSortPlaying) {
				clickPlayButton();
			} 
		}
	};

	workerOnError = function (event) {
		console.log(event);
	};

	doSort = function () {
		if (typeof Worker === 'undefined') {
			return;
		}
		if (worker !== null) {
			worker.removeEventListener('message', workerOnMessage, false);
			worker.removeEventListener('error', workerOnError, false);
			worker.terminate();
		}
		workerKey = (new Date()).getTime();
		worker = new Worker(workerUrl);
		worker.addEventListener('message', workerOnMessage, false);
		worker.addEventListener('error', workerOnError, false);
		worker.postMessage({
			key : workerKey,
			fn : global.sort[selected.sort].toString(),
			arr : baseData
		});
	};

	AudioSort.createSlider = function (selector, obj, onChange) {
		var $container = $(selector), $elem = $('<div class="audio-sort-slider"></div>'), $slider;
		$container.empty();
		$elem.appendTo($container);
		$slider = $elem.slider({
			value: obj.value,
			min: obj.min,
			max: obj.max,
			step: obj.step,
			orientation: 'horizontal',
			selection: 'none',
			tooltip: 'hide'
		});
		$slider.on('slide', onChange);
		$slider.on('slideStop', onChange);
		$(selector + ' .slider').width('100%');
		return $slider;
	};

	AudioSort.getSelected = function (key, defaultValue) {
		return selected.hasOwnProperty(key) ? selected[key] : defaultValue;
	};

	AudioSort.init = function (webWorkerUrl) {
		if (typeof webWorkerUrl === 'string') {
			workerUrl = webWorkerUrl;
		}
		// build our sort options
		buildSortOptions('#sort-options');
		// setup audio and audio players
		setupPlayers();
		// setup base data
		baseData = global.fn.datagen.randomUnique(selected.dataSize);
		maxData = global.fn.datagen.sorted(defaults.dataSize.max);
		players.base.setData(getBaseDataAsFrames());
		// populate our scale drop down
		populateSelect('#scale-select', '#scale_select_chzn', onScaleChange);
		// create some of our sliders
		AudioSort.createSlider('#volume-container', defaults.volume, onSliderVolume);
		AudioSort.createSlider('#tempo-container', defaults.tempo, onSliderTempo);
		AudioSort.createSlider('#center-note-container', defaults.centerNote, onSliderCenterNote);
		AudioSort.createSlider('#data-size-container', defaults.dataSize, onSliderDataSize);
		// handle button clicks
		$('#sort-modal-open').on('click', onSortModalClick);
		$('#add-algorithm-btn').on('click', onAddAlgorithmModalClick);
		$('#save-algorithm-edit').on('click', onSaveAlgorithmEdit);
		$('#save-algorithm-new').on('click', onSaveAlgorithmNew);
		$('#base-buttons').on('click', '.btn', onAudioDataButton);
		$('#sort-options').on('click', 'li', onSortOptionSelected);
		$('#sort-options [data-sort=' + selected.sort + ']').click();
		// update slider selction text
		updateDisplayCache('#volume-display', selected.volume);
		updateDisplayCache('#tempo-display', selected.tempo);
		updateDisplayCache('#center-note-display', selected.centerNote, getNoteName);
		updateDisplayCache('#data-size-display', selected.dataSize);
	};

	global.AudioSort = AudioSort;
}(this));