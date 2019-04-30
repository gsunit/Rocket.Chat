import { Meteor } from 'meteor/meteor';
import { Subscriptions } from '../../app/models';

Meteor.methods({
	'userActivityCounter.set' : (userId, username, roomId) => {
		const now = new Date();

		const customFields = {
			userActivityCounterFlag : true,
			lastUpdated : now,
			rid : roomId,
			uid : userId,
			username,
			messageCount : 0,
		};

		const ret = Subscriptions.updateCustomFieldsByRoomIdAndUserId(roomId, userId, customFields);
		return ret;
	},
});
