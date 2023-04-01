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
      } else {
        const team = teamSnapshot.docs[0];
        const teamData = team.data();
        console.log("users:", teamData.users);
        console.log("qty:", subscription.quantity);
        const users = Array.isArray(teamData.users) ? teamData.users : [];

        const batch = admin.firestore().batch();
        let count = 0;

        for (const user of users) {
          count++;
          const userRef = admin.firestore().collection("users").doc(user);
          const isSubscribed =
            subscriptionActive && count <= subscription.quantity;
          batch.update(userRef, {subscribed: isSubscribed});
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
    const newData = change.after.data() ?? null;

    if (!previousData || !newData) {
      console.log("No team data found or team created/deleted");
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

    const ownerId = newData.ownerId;
    const usersRef = admin.firestore().collection("users");
    const ownerDoc = await usersRef.doc(ownerId).get();
    const ownerData = ownerDoc.data();
    console.log("owner:", newData.ownerId);
    console.log("owner:", ownerData);

    if (!ownerData || !ownerData.subscription) {
      console.log("No subscription data found for the team owner");
      return null;
    }

    const subscription = ownerData.subscription;
    console.log("owner:", subscription);
    console.log("qty:", subscription.quantity);
    const subscriptionActive =
      subscription.status === "active" || subscription.status === "trialing";

    // Update subscribed state for all users in the team
    const batch = admin.firestore().batch();
    let count = 0;

    for (const uid of newData.users) {
      count++;
      const userRef = usersRef.doc(uid);
      const isSubscribed = subscriptionActive && count <= subscription.quantity;
      batch.update(userRef, {subscribed: isSubscribed});
    }

    await batch.commit();
    console.log("User subscribed state updated");
    return null;
  });
