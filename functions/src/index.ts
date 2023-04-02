import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();

export const onSubscriptionChange = functions
  .region("australia-southeast1")
  .firestore.document("users/{userId}/subscriptions/{subscriptionId}")
  .onWrite(
    async (
      change: functions.Change<functions.firestore.DocumentSnapshot>,
      context: functions.EventContext
    ) => {
      const uid: string = context.params.userId;
      const subscription = change.after.data();

      if (!subscription) {
        console.error("Subscription not found");
        return;
      }

      const teamName = "New Team";
      const teamSnapshot = await admin
        .firestore()
        .collection("teams")
        .where("ownerId", "==", uid)
        .get();

      const subscriptionActive: boolean = ["trialing", "active"].includes(
        subscription.status
      );

      if (teamSnapshot.empty) {
        await admin
          .firestore()
          .collection("teams")
          .add({
            name: teamName,
            ownerId: uid,
            admins: [uid],
            users: [uid],
          });
        const userRef = admin.firestore().collection("users").doc(uid);
        const isSubscribed = subscriptionActive && subscription.quantity > 0;
        userRef.update({ subscribed: isSubscribed });
      } else {
        const team = teamSnapshot.docs[0];
        const teamData = team.data();
        const users = Array.isArray(teamData.users) ? teamData.users : [];

        const batch = admin.firestore().batch();
        let count = 0;

        for (const user of users) {
          count++;
          const userRef = admin.firestore().collection("users").doc(user);
          const isSubscribed =
            subscriptionActive && count <= subscription.quantity;
          batch.update(userRef, { subscribed: isSubscribed });
        }

        await batch.commit();
        console.log("User subscribed state updated");
      }
    }
  );

exports.onTeamUsersChange = functions
  .region("australia-southeast1")
  .firestore.document("teams/{teamId}")
  .onWrite(async (change, context) => {
    const previousData = change.before.data() ?? null;
    if (!previousData) {
      console.log(
        "Team is being created by stripe and other function will handle it"
      );
      return null;
    }

    const usersRef = admin.firestore().collection("users");
    const batch = admin.firestore().batch();
    const newData = change.after.data() ?? null;
    if (!newData) {
      for (const uid of previousData.users) {
        const userRef = usersRef.doc(uid);
        batch.update(userRef, { subscribed: false });
      }
      await batch.commit();
      console.log("All team's users subscriptions deactivated");
      return null;
    }

    const addedUsers = newData.users.filter(
      (uid: string) => !previousData.users.includes(uid)
    );
    const removedUsers = previousData.users.filter(
      (uid: string) => !newData.users.includes(uid)
    );

    if (addedUsers.length === 0 && removedUsers.length === 0) {
      console.log("No user changes detected");
      return null;
    }

    for (const uid of removedUsers) {
      const userRef = usersRef.doc(uid);
      batch.update(userRef, { subscribed: false });
    }

    const ownerId = newData.ownerId;
    const subscriptions = await usersRef
      .doc(ownerId)
      .collection("subscriptions")
      .where("status", "==", "active")
      .limit(1)
      .get();

    if (!subscriptions.empty) {
      const subscription = subscriptions.docs[0].data();
      const subscriptionActive =
        subscription.status === "active" || subscription.status === "trialing";
      let count = 0;
      for (const uid of newData.users) {
        count++;
        const userRef = usersRef.doc(uid);
        const isSubscribed =
          subscriptionActive && count <= subscription.quantity;
        batch.update(userRef, { subscribed: isSubscribed });
      }

      await batch.commit();
      console.log("User subscribed state updated");
      return null;
    } else {
      console.log("No subscription data found for the team owner");
      return null;
    }
  });
