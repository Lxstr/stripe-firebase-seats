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
      const subscriptionAfter = change.after.data();

      if (!subscriptionAfter) {
        console.log("Subscription deleted");

        const teamSnapshot = await admin
          .firestore()
          .collection("teams")
          .where("ownerId", "==", uid)
          .get();

        const batch = admin.firestore().batch();

        for (const teamDoc of teamSnapshot.docs) {
          const membersSnapshot = await teamDoc.ref.collection("members").get();
          for (const memberDoc of membersSnapshot.docs) {
            batch.update(memberDoc.ref, { is_subscribed: false });
          }
        }

        await batch.commit();
        return;
      }

      const teamSnapshot = await admin
        .firestore()
        .collection("teams")
        .where("ownerId", "==", uid)
        .get();

      const subscriptionActive: boolean = ["trialing", "active"].includes(
        subscriptionAfter.status
      );
      const userRef = admin.firestore().collection("users").doc(uid);

      if (teamSnapshot.empty) {
        const teamName = "New Team";
        const teamDocRef = await admin.firestore().collection("teams").add({
          name: teamName,
          ownerId: uid,
          quantity: subscriptionAfter.quantity,
        });

        const teamId = teamDocRef.id;
        const isSubscribed =
          subscriptionActive && subscriptionAfter.quantity > 0;

        await teamDocRef.collection("members").doc(uid).set({
          is_user: true,
          is_subscribed: isSubscribed,
        });

        await userRef.update({
          associatedTeam: teamId,
        });
      } else {
        const team = teamSnapshot.docs[0];
        const teamData = team.data();
        const members = Array.isArray(teamData.members) ? teamData.members : [];
        await team.ref.update({ quantity: subscriptionAfter.quantity });
        const batch = admin.firestore().batch();
        console.log(members);
        let count = 0;
        for (const member of members) {
          console.log(member);
          const isUser = member.is_user ?? false;
          console.log("iterate members");
          const isSubscribed =
            subscriptionActive && isUser && count < subscriptionAfter.quantity;
          console.log(isSubscribed);
          if (isSubscribed) {
            count++;
          }
          const memberRef = admin
            .firestore()
            .collection("teams")
            .doc(team.id)
            .collection("members")
            .doc(member.uid);
          console.log(memberRef);
          batch.update(memberRef, { is_subscribed: isSubscribed });
        }

        await batch.commit();
        console.log("User subscription state updated");
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
      console.log("Team removed");
      return null;
    }

    const removedUsers = previousData.users.filter(
      (uid: string) => !newData.users.includes(uid)
    );

    if (removedUsers) {
      for (const uid of removedUsers) {
        const userRef = usersRef.doc(uid);
        batch.update(userRef, { subscribed: false });
      }
      return null;
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
      const teamId = context.params.teamId;
      const membersRef = admin
        .firestore()
        .collection("teams")
        .doc(teamId)
        .collection("members");
      let count = 0;
      for (const uid of newData.users) {
        count++;
        const memberRef = membersRef.doc(uid);
        const isSubscribed =
          subscriptionActive && count <= subscription.quantity;
        batch.update(memberRef, { subscribed: isSubscribed });
      }

      await batch.commit();
      console.log("User subscribed state updated");
      return null;
    } else {
      console.log("No subscription data found for the team owner");
      return null;
    }
  });
