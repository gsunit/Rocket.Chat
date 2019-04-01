import { Meteor } from 'meteor/meteor';
import { Blaze } from 'meteor/blaze';
import { Template } from 'meteor/templating';
import { TAPi18n } from 'meteor/tap:i18n';

import _ from 'underscore';
import moment from 'moment';

import { DateFormat } from '../../lib';
import { renderEmoji } from '../../emoji';
import { renderMessageBody, MessageTypes, MessageAction, call } from '../../ui-utils';
import { RoomRoles, UserRoles, Roles, Messages } from '../../models';
import { AutoTranslate } from '../../autotranslate';
import { callbacks } from '../../callbacks';
import { Markdown } from '../../markdown';
import { t, roomTypes } from '../../utils';

async function renderPdfToCanvas(canvasId, pdfLink) {
	const isSafari = /constructor/i.test(window.HTMLElement) ||
		((p) => p.toString() === '[object SafariRemoteNotification]')(!window.safari ||
			(typeof window.safari !== 'undefined' && window.safari.pushNotification));

	if (isSafari) {
		const [, version] = /Version\/([0-9]+)/.exec(navigator.userAgent) || [null, 0];
		if (version <= 12) {
			return;
		}
	}

	if (!pdfLink || !/\.pdf$/i.test(pdfLink)) {
		return;
	}

	const canvas = document.getElementById(canvasId);
	if (!canvas) {
		return;
	}

	const pdfjsLib = await import('pdfjs-dist');
	pdfjsLib.GlobalWorkerOptions.workerSrc = `${ Meteor.absoluteUrl() }pdf.worker.min.js`;

	const loader = document.getElementById(`js-loading-${ canvasId }`);

	if (loader) {
		loader.style.display = 'block';
	}

	const pdf = await pdfjsLib.getDocument(pdfLink);
	const page = await pdf.getPage(1);
	const scale = 0.5;
	const viewport = page.getViewport(scale);
	const context = canvas.getContext('2d');
	canvas.height = viewport.height;
	canvas.width = viewport.width;
	await page.render({
		canvasContext: context,
		viewport,
	}).promise;

	if (loader) {
		loader.style.display = 'none';
	}

	canvas.style.maxWidth = '-webkit-fill-available';
	canvas.style.maxWidth = '-moz-available';
	canvas.style.display = 'block';
}

Template.message.helpers({
	and(a, b) {
		return a && b;
	},
	i18nKeyMessage() {
		const { msg } = this;
		return msg.dcount > 1
			? 'messages'
			: 'message';
	},
	i18nKeyReply() {
		const { msg } = this;
		return msg.tcount > 1
			? 'replies'
			: 'reply';
	},
	formatDate(date) {
		return moment(date).format('LLL');
	},
	encodeURI(text) {
		return encodeURI(text);
	},
	broadcast() {
		const { msg, room } = this;
		return !msg.private && !msg.t && msg.u._id !== Meteor.userId() && room && room.broadcast;
	},
	isIgnored() {
		const { msg } = this;
		return msg.ignored;
	},
	ignoredClass() {
		const { msg } = this;
		return msg.ignored ? 'message--ignored' : '';
	},
	isDecrypting() {
		const { msg } = this;
		return msg.e2e === 'pending';
	},
	isBot() {
		const { msg } = this;
		return msg.bot && 'bot';
	},
	roleTags() {
		const { msg, hideRoles } = this;
		if (hideRoles) {
			return [];
		}

		if (!msg.u || !msg.u._id) {
			return [];
		}
		const userRoles = UserRoles.findOne(msg.u._id);
		const roomRoles = RoomRoles.findOne({
			'u._id': msg.u._id,
			rid: msg.rid,
		});
		const roles = [...(userRoles && userRoles.roles) || [], ...(roomRoles && roomRoles.roles) || []];
		return Roles.find({
			_id: {
				$in: roles,
			},
			description: {
				$exists: 1,
				$ne: '',
			},
		}, {
			fields: {
				description: 1,
			},
		});
	},
	isGroupable() {
		const { msg, room, settings } = this;
		if (settings.allowGroup === false || room.broadcast || msg.groupable === false) {
			return 'false';
		}
	},
	isSequential() {
		const { msg, room } = this;
		return msg.groupable && !room.broadcast;
	},
	sequentialClass() {
		const { msg } = this;
		return msg.groupable !== false && 'sequential';
	},
	avatarFromUsername() {
		const { msg } = this;

		if (msg.avatar != null && msg.avatar[0] === '@') {
			return msg.avatar.replace(/^@/, '');
		}
	},
	getEmoji(emoji) {
		return renderEmoji(emoji);
	},
	getName() {
		const { msg, settings } = this;
		if (msg.alias) {
			return msg.alias;
		}
		if (!msg.u) {
			return '';
		}
		return (settings.UI_Use_Real_Name && msg.u.name) || msg.u.username;
	},
	showUsername() {
		const { msg, settings } = this;
		return msg.alias || (settings.UI_Use_Real_Name && msg.u && msg.u.name);
	},
	own() {
		const { msg } = this;
		if (msg.u && msg.u._id === Meteor.userId()) {
			return 'own';
		}
	},
	timestamp() {
		const { msg } = this;
		return +msg.ts;
	},
	chatops() {
		const { msg, settings } = this;
		if (msg.u && msg.u.username === settings.Chatops_Username) {
			return 'chatops-message';
		}
	},
	time() {
		const { msg } = this;
		return DateFormat.formatTime(msg.ts);
	},
	date() {
		const { msg } = this;
		return DateFormat.formatDate(msg.ts);
	},
	isTemp() {
		const { msg } = this;
		if (msg.temp === true) {
			return 'temp';
		}
	},
	body() {
		return Template.instance().body;
	},
	bodyClass() {
		const { msg } = this;
		return MessageTypes.isSystemMessage(msg) ? 'color-info-font-color' : 'color-primary-font-color';
	},
	system(returnClass) {
		const { msg } = this;
		if (MessageTypes.isSystemMessage(msg)) {
			if (returnClass) {
				return 'color-info-font-color';
			}
			return 'system';
		}
	},
	showTranslated() {
		const { msg, subscription, settings } = this;
		if (settings.AutoTranslate_Enabled && msg.u && msg.u._id !== Meteor.userId() && !MessageTypes.isSystemMessage(msg)) {
			const language = AutoTranslate.getLanguage(msg.rid);
			return msg.autoTranslateFetching || (subscription && subscription.autoTranslate !== msg.autoTranslateShowInverse && msg.translations && msg.translations[language]);
		}
	},
	edited() {
		return Template.instance().wasEdited;
	},
	editTime() {
		const { msg } = this;
		if (Template.instance().wasEdited) {
			return DateFormat.formatDateAndTime(msg.editedAt);
		}
	},
	editedBy() {
		if (!Template.instance().wasEdited) {
			return '';
		}
		const { msg } = this;
		// try to return the username of the editor,
		// otherwise a special "?" character that will be
		// rendered as a special avatar
		return (msg.editedBy && msg.editedBy.username) || '?';
	},
	canEdit() {
		const { msg, settings } = this;
		const hasPermission = settings.hasPermissionDeleteMessage;
		const isEditAllowed = settings.Message_AllowEditing;
		const editOwn = msg.u && msg.u._id === Meteor.userId();
		if (!(hasPermission || (isEditAllowed && editOwn))) {
			return;
		}
		const blockEditInMinutes = settings.Message_AllowEditing_BlockEditInMinutes;
		if (blockEditInMinutes) {
			let msgTs;
			if (msg.ts != null) {
				msgTs = moment(msg.ts);
			}
			let currentTsDiff;
			if (msgTs != null) {
				currentTsDiff = moment().diff(msgTs, 'minutes');
			}
			return currentTsDiff < blockEditInMinutes;
		}

		return true;
	},
	canDelete() {
		const { msg, settings } = this;

		const hasPermission = settings.hasPermissionDeleteMessage;
		const isDeleteAllowed = settings.Message_AllowDeleting;
		const deleteOwn = msg.u && msg.u._id === Meteor.userId();
		if (!(hasPermission || (isDeleteAllowed && deleteOwn))) {
			return;
		}
		const blockDeleteInMinutes = settings.Message_AllowDeleting_BlockDeleteInMinutes;
		if (blockDeleteInMinutes) {
			let msgTs;
			if (msg.ts != null) {
				msgTs = moment(msg.ts);
			}
			let currentTsDiff;
			if (msgTs != null) {
				currentTsDiff = moment().diff(msgTs, 'minutes');
			}
			return currentTsDiff < blockDeleteInMinutes;
		} else {
			return true;
		}
	},
	showEditedStatus() {
		const { settings } = this;
		return settings.Message_ShowEditedStatus;
	},
	label() {
		const { msg } = this;

		if (msg.i18nLabel) {
			return t(msg.i18nLabel);
		} else if (msg.label) {
			return msg.label;
		}
	},
	hasOembed() {
		const { msg, settings } = this;
		// there is no URLs, there is no template to show the oembed (oembed package removed) or oembed is not enable
		if (!(msg.urls && msg.urls.length > 0) || !Template.oembedBaseWidget || !settings.API_Embed) {
			return false;
		}

		// check if oembed is disabled for message's sender
		if ((settings.API_EmbedDisabledFor || '').split(',').map((username) => username.trim()).includes(msg.u && msg.u.username)) {
			return false;
		}
		return true;
	},
	reactions() {
		const { msg, u } = this;
		const userUsername = u.username;
		return Object.keys(msg.reactions || {}).map((emoji) => {
			const reaction = msg.reactions[emoji];
			const total = reaction.usernames.length;
			let usernames = reaction.usernames
				.slice(0, 15)
				.map((username) => (username === userUsername ? t('You').toLowerCase() : `@${ username }`))
				.join(', ');
			if (total > 15) {
				usernames = `${ usernames } ${ t('And_more', {
					length: total - 15,
				}).toLowerCase() }`;
			} else {
				usernames = usernames.replace(/,([^,]+)$/, ` ${ t('and') }$1`);
			}
			if (usernames[0] !== '@') {
				usernames = usernames[0].toUpperCase() + usernames.substr(1);
			}
			return {
				emoji,
				count: reaction.usernames.length,
				usernames,
				reaction: ` ${ t('Reacted_with').toLowerCase() } ${ emoji }`,
				userReacted: reaction.usernames.indexOf(userUsername) > -1,
			};
		});
	},
	markUserReaction(reaction) {
		if (reaction.userReacted) {
			return {
				class: 'selected',
			};
		}
	},
	hideReactions() {
		const { msg } = this;
		if (_.isEmpty(msg.reactions)) {
			return 'hidden';
		}
	},
	actionLinks() {
		const { msg } = this;
		// remove 'method_id' and 'params' properties
		return _.map(msg.actionLinks, function(actionLink, key) {
			return _.extend({
				id: key,
			}, _.omit(actionLink, 'method_id', 'params'));
		});
	},
	hideActionLinks() {
		const { msg } = this;
		if (_.isEmpty(msg.actionLinks)) {
			return 'hidden';
		}
	},
	injectIndex(data, index) {
		data.index = index;
	},
	hideCog() {
		const { subscription } = this;
		// const subscription = Subscriptions.findOne({
		// 	rid: this.rid,
		// });
		if (subscription == null) {
			return 'hidden';
		}
	},
	channelName() {
		const { subscription } = this;
		// const subscription = Subscriptions.findOne({ rid: this.rid });
		return subscription && subscription.name;
	},
	roomIcon() {
		const { room } = this;
		if (room && room.t === 'd') {
			return 'at';
		}
		return roomTypes.getIcon(room);
	},
	fromSearch() {
		const { customClass } = this;
		return customClass === 'search';
	},
	actionContext() {
		const { msg } = this;
		return msg.actionContext;
	},
	messageActions(group) {
		const { msg } = this;
		let messageGroup = group;
		let context = msg.actionContext;

		if (!group) {
			messageGroup = 'message';
		}

		if (!context) {
			context = 'message';
		}

		return MessageAction.getButtons(msg, context, messageGroup);
	},
	isSnippet() {
		const { msg } = this;
		return msg.actionContext === 'snippeted';
	},
	parentMessage() {
		const { msg } = this;
		const message = Messages.findOne(msg.tmid);
		return message && message.msg;
	},
});

const cache = {};
const findParentMessage = async(tmid) => {
	if (cache[tmid]) {
		return;
	}

	const message = Messages.findOne({ _id: tmid });
	if (message) {
		return;
	}
	cache[tmid] = call('getSingleMessage', tmid);
	const msg = await cache[tmid];
	Messages.insert(msg);
	delete cache[tmid];
};


const renderBody = (msg, settings) => {
	const isSystemMessage = MessageTypes.isSystemMessage(msg);
	const messageType = MessageTypes.getType(msg) || {};
	if (msg.thread_message) {
		msg.reply = Markdown.parse(TAPi18n.__('Thread_message', {
			username: msg.u.username,
			msg: msg.thread_message.msg,
		}));
	}

	if (messageType.render) {
		msg = messageType.render(msg);
	} else if (messageType.template) {
		// render template
	} else if (messageType.message) {
		msg = TAPi18n.__(messageType.message, { ... typeof messageType.data === 'function' && messageType.data(msg) });
	} else if (msg.u && msg.u.username === settings.Chatops_Username) {
		msg.html = msg.msg;
		msg = callbacks.run('renderMentions', msg);
		msg = msg.html;
	} else {
		msg = renderMessageBody(msg);
	}

	if (isSystemMessage) {
		msg.html = Markdown.parse(msg.html);
	}
	return msg;
};

Template.message.onCreated(function() {
	// const [, currentData] = Template.currentData()._arguments;
	// const { msg, settings } = currentData.hash;
	const { msg, settings } = Template.currentData();

	this.wasEdited = msg.editedAt && !MessageTypes.isSystemMessage(msg);
	if (msg.tmid && !msg.thread_message) {
		findParentMessage(msg.tmid);
	}
	return this.body = renderBody(msg, settings);
});

const hasTempClass = (node) => node.classList.contains('temp');


const getPreviousSentMessage = (currentNode) => {
	if (hasTempClass(currentNode)) {
		return currentNode.previousElementSibling;
	}
	if (currentNode.previousElementSibling != null) {
		let previousValid = currentNode.previousElementSibling;
		while (previousValid != null && hasTempClass(previousValid)) {
			previousValid = previousValid.previousElementSibling;
		}
		return previousValid;
	}
};

const setNewDayAndGroup = (currentNode, previousNode, forceDate, period) => {


	const { classList } = currentNode;

	// const $nextNode = $(nextNode);
	if (previousNode == null) {
		classList.remove('sequential');
		return classList.add('new-day');
	}

	const previousDataset = previousNode.dataset;
	const currentDataset = currentNode.dataset;
	const previousMessageDate = new Date(parseInt(previousDataset.timestamp));
	const currentMessageDate = new Date(parseInt(currentDataset.timestamp));

	if (forceDate || previousMessageDate.toDateString() !== currentMessageDate.toDateString()) {
		classList.add('new-day');
	}

	if (previousDataset.username !== currentDataset.username || parseInt(currentDataset.timestamp) - parseInt(previousDataset.timestamp) > period) {
		return classList.remove('sequential');
	}

	if ([previousDataset.groupable, currentDataset.groupable].includes('false')) {
		return classList.remove('sequential');
	}

};

Template.message.onViewRendered = function(context) {
	const [, currentData] = Template.currentData()._arguments;
	const { settings, noDate, forceDate } = currentData.hash;
	if (context.file && context.file.type === 'application/pdf') {
		Meteor.defer(() => { renderPdfToCanvas(context.file._id, context.attachments[0].title_link); });
	}
	return !noDate && this._domrange.onAttached((domRange) => {
		const currentNode = domRange.lastNode();
		const previousNode = getPreviousSentMessage(currentNode);
		const nextNode = currentNode.nextElementSibling;
		setNewDayAndGroup(currentNode, previousNode, forceDate, settings.Message_GroupingPeriod * 1000);
		// if (nextNode && nextNode.dataset) {
		// 	const nextDataset = nextNode.dataset;
		// 	if (nextDataset.date !== currentDataset.date) {
		// 		$nextNode.addClass('new-day').removeClass('sequential');
		// 	} else {
		// 		$nextNode.removeClass('new-day');
		// 	}
		// 	if (nextDataset.groupable !== 'false') {
		// 		if (nextDataset.username !== currentDataset.username || parseInt(nextDataset.timestamp) - parseInt(currentDataset.timestamp) > settings.Message_GroupingPeriod * 1000) {
		// 			$nextNode.removeClass('sequential');
		// 		} else if (!$nextNode.hasClass('new-day') && !hasTempClass(currentNode)) {
		// 			$nextNode.addClass('sequential');
		// 		}
		// 	}
		// }
		if (nextNode == null) {
			const [el] = $(`#chat-window-${ context.rid }`);
			const view = el && Blaze.getView(el);
			const templateInstance = view && view.templateInstance();
			if (!templateInstance) {
				return;
			}

			if (currentNode.classList.contains('own') === true) {
				templateInstance.atBottom = true;
			}
			templateInstance.sendToBottomIfNecessary();
		}

	});
};
