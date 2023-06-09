This package allows you to upload a google cloud function that will extend the firebase stripe extension, allowing you to use a seats based subscription model.

The function is triggered by any new or changed subscription and creates or updates a team object in firestore with a relevant structure (trimmed down for readability):

```
teams (collection)
├─ {teamId} (document)
│  ├─ ownerId: string (id)
│  ├─ name: string
│  ├─ admins: Array<string> (ids)
│  └─ users: Array<string> (ids)
```

```
users (collection)
├─ {userId} (document)
│  ├─ uid: string
│  ├─ associatedTeam: string
│  ├─ subscribed: bool
│  └─ subscriptions (subcollection)
│      └─ {subscriptionId} (document)
│         ├─ status: string
│         └─ quantity: number
```

Ensure you have firebase, firestore, google service account and stripe-payments firebase extension installed correctly.

```
npm install -g firebase-tools
firebase login
```

In new directory:

```
git clone
npm run deploy
```

See your new cloud function here:

[https://console.cloud.google.com/functions/list](https://console.cloud.google.com/functions/list)
