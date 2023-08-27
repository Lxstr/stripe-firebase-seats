// Import necessary Firebase modules
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

// Initialize the Firebase Admin SDK
admin.initializeApp();

// Function to update subscription status for team members
const updateIsSubscribed = async (
  teamId: string,
  subscriptionActive: boolean,
  quantity: number
) => {
  // Retrieve a snapshot of team members
  const membersSnapshot = await admin
    .firestore()
    .collection("teams")
    .doc(teamId)
    .collection("members")
    .get();
  let count = 1;

  // Create a batch for updating documents
  const batch = admin.firestore().batch();

  // Loop through each member and update their subscription status
  for (const memberDoc of membersSnapshot.docs) {
    const memberData = memberDoc.data();
    const uid = memberDoc.id;
    const isUser = memberData.is_user;
    const isSubscribed = subscriptionActive && isUser && count <= quantity;

    if (isSubscribed) count++;

    // Update member's subscription status
    batch.update(memberDoc.ref, { is_subscribed: isSubscribed });

    // Retrieve the user document for additional updates
    const userDoc = await admin.firestore().collection("users").doc(uid).get();

    // Update user's subscription status and associated team
    if (userDoc.exists) {
      batch.update(userDoc.ref, {
        is_subscribed: isSubscribed,
        // associatedTeam: teamId,
      });
    }
  }

  // Commit the batch updates
  await batch.commit();
};

// Cloud Function triggered on subscription change for a user
export const onSubscriptionChange = functions
  .region("australia-southeast1")
  .firestore.document("users/{userId}/subscriptions/{subscriptionId}")
  .onWrite(async (change, context) => {
    const userId = context.params.userId;

    // Retrieve teams owned by the user
    const teamSnapshot = await admin
      .firestore()
      .collection("teams")
      .where("ownerId", "==", userId)
      .get();

    // Determine the subscription status and quantity
    const subscription = change.after.exists ? change.after.data() : null;
    const subscriptionActive = subscription?.status === "active";
    const quantity = subscription?.quantity ?? 0;

    // Check if user has a team associated with them
    if (!teamSnapshot.empty) {
      const teamDoc = teamSnapshot.docs[0];
      const teamId = teamDoc.id;
      await updateIsSubscribed(teamId, subscriptionActive, quantity);
    }
    // If not, create a team and give user access
    // else if (quantity > 1) {
    //   const teamDocRef = await admin.firestore().collection("teams").add({
    //     ownerId: userId,
    //     admins: [],
    //     members: [],
    //   });
    //   const teamId = teamDocRef.id;
    //   const userDoc = await admin
    //     .firestore()
    //     .collection("users")
    //     .doc(userId)
    //     .get();
    //   const userData = userDoc.data();

    //   if (userData) {
    //     await admin
    //       .firestore()
    //       .collection("teams")
    //       .doc(teamId)
    //       .collection("members")
    //       .add({
    //         email: userData.email,
    //         is_admin: true,
    //         is_user: true,
    //       });
    //   }
    //   userDoc.ref.update({ subscribed: true, associatedTeam: teamId });
    // } 
    // If the subscription quantity is 1, update the user's subscription status
    else if (quantity === 1) {
      await admin
        .firestore()
        .collection("users")
        .doc(userId)
        .set({ is_subscribed: subscriptionActive });
    }
  });

// Cloud Function triggered on member change within a team
export const onMemberChange = functions
  .region("australia-southeast1")
  .firestore.document("teams/{teamId}/members/{memberId}")
  .onWrite(async (change, context) => {
    const teamId = context.params.teamId;

    if (!teamId) {
      console.error("Invalid teamId:", teamId);
      return;
    }

    // Retrieve team data
    const teamSnapshot = await admin
      .firestore()
      .collection("teams")
      .doc(teamId)
      .get();
    const teamData = teamSnapshot.data();

    if (teamData) {
      const ownerId = teamData.ownerId;
      const usersRef = admin.firestore().collection("users");

      // Retrieve the owner's active subscription
      const subscriptionsSnapshot = await usersRef
        .doc(ownerId)
        .collection("subscriptions")
        .where("status", "==", "active")
        .limit(1)
        .get();

      // If the owner has an active subscription, update team members' subscription status
      if (!subscriptionsSnapshot.empty) {
        const subscription = subscriptionsSnapshot.docs[0].data();
        const subscriptionActive = subscription.status === "active";
        const quantity = subscription.quantity;
        await updateIsSubscribed(teamId, subscriptionActive, quantity);
      } else {
        const subscriptionActive = false;
        const quantity = 0;
        await updateIsSubscribed(teamId, subscriptionActive, quantity);
      }
    }
  });