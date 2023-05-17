import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();

const updateIsSubscribed = async (
  teamId: string,
  subscriptionActive: boolean,
  quantity: number
) => {
  console.log(teamId);
  console.log(subscriptionActive);
  console.log(quantity);
  const membersSnapshot = await admin
    .firestore()
    .collection("teams")
    .doc(teamId)
    .collection("members")
    .get();
  let count = 1;

  const batch = admin.firestore().batch();
  membersSnapshot.forEach((memberDoc) => {
    const memberData = memberDoc.data();
    console.log(memberData);
    const isUser = memberData.is_user;
    const isSubscribed = subscriptionActive && isUser && count <= quantity;
    console.log("should sub");
    console.log(isSubscribed);
    if (isSubscribed) count++;
    if (memberData.is_subscribed !== isSubscribed) {
      batch.update(memberDoc.ref, { is_subscribed: isSubscribed });
    }
  });

  await batch.commit();
};

export const onSubscriptionChange = functions
  .region("australia-southeast1")
  .firestore.document("users/{userId}/subscriptions/{subscriptionId}")
  .onWrite(async (change, context) => {
    const userId = context.params.userId;
    const teamSnapshot = await admin
      .firestore()
      .collection("teams")
      .where("ownerId", "==", userId)
      .get();
    const subscription = change.after.exists ? change.after.data() : null;
    const subscriptionActive = subscription?.status === "active";
    const quantity = subscription?.quantity ?? 0;
    if (!teamSnapshot.empty) {
      const teamDoc = teamSnapshot.docs[0];
      const teamId = teamDoc.id;
      await updateIsSubscribed(teamId, subscriptionActive, quantity);
    }
  });

export const onMemberChange = functions
  .region("australia-southeast1")
  .firestore.document("teams/{teamId}/members/{memberId}")
  .onWrite(async (change, context) => {
    console.log(context);
    const teamId = context.params.teamId;

    if (!teamId) {
      console.error("Invalid teamId:", teamId);
      return;
    }

    const teamSnapshot = await admin
      .firestore()
      .collection("teams")
      .doc(teamId)
      .get();
    const teamData = teamSnapshot.data();
    console.log(teamData);

    if (teamData) {
      const ownerId = teamData.ownerId;
      console.log(ownerId);
      const usersRef = admin.firestore().collection("users");
      console.log(usersRef);

      const subscriptionsSnapshot = await usersRef
        .doc(ownerId)
        .collection("subscriptions")
        .where("status", "==", "active")
        .limit(1)
        .get();
      console.log(subscriptionsSnapshot);

      if (!subscriptionsSnapshot.empty) {
        const subscription = subscriptionsSnapshot.docs[0].data();
        const subscriptionActive = subscription.status === "active";
        const quantity = subscription.quantity;

        await updateIsSubscribed(teamId, subscriptionActive, quantity);
      }
    }
  });
