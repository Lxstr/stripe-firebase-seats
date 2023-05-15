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
      const userRef = admin.firestore().collection("users").doc(uid);

      if (teamSnapshot.empty) {
        const teamDocRef = await admin.firestore().collection("teams").add({
          name: teamName,
          ownerId: uid,
          quantity: subscription.quantity,
        });

        teamDocRef.collection("members").doc(uid).set({
          uid: uid,
          is_subscribed: true,
        });

        const teamId = teamDocRef.id;
        const isSubscribed = subscriptionActive && subscription.quantity > 0;
        userRef.update({ subscribed: isSubscribed, associatedTeam: teamId });
      } else {
        const team = teamSnapshot.docs[0];
        const teamData = team.data();
        const members = Array.isArray(teamData.members) ? teamData.members : [];
        team.ref.update({ quantity: subscription.quantity });
        const batch = admin.firestore().batch();

        let count = 0;
        for (const member of members) {
          const isUser = member.is_user ?? false;

          const isSubscribed =
            subscriptionActive && isUser && count <= subscription.quantity;
          if (isSubscribed) {
            count++;
          }
          const memberRef = admin
            .firestore()
            .collection("teams")
            .doc(team.id)
            .collection("members")
            .doc(member.uid);
          batch.update(userRef, { is_subscribed: isSubscribed });
          batch.update(memberRef, { is_subscribed: isSubscribed });
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
      for (const uid of previousData.members) {
        const userRef = usersRef.doc(uid);
        batch.update(userRef, { subscribed: false });
      }
      await batch.commit();
      console.log("All team's users subscriptions deactivated");
      return null;
    }

    const removedUsers = previousData.members.filter(
      (uid: string) => !newData.members.includes(uid)
    );

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
      for (const uid of newData.members) {
        const isUser =
          newData.members.find((member: any) => member.uid === uid)?.is_user ??
          false;

        const isSubscribed =
          subscriptionActive && isUser && count <= subscription.quantity;
        if (isSubscribed) {
          count++;
        }

        const userRef = usersRef.doc(uid);
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
