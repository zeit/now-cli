# Scope Not Existent

#### Why This Error Occurred

You specified the `--scope` flag and specified the ID or slug of a team that does not exist or that you're not a member. Similarly you might have specified the ID or username of user whose account you don't own.

#### Possible Ways to Fix It

- Make sure commands like `vercel ls` work just fine. This will ensure that your user credentials are valid. If it's not working correctly, please log in again using `vercel login`.
- If you're using the `--token` flag, make sure your token is not expired. You can generate a new token on your [Settings page](https://vercel.com/account/tokens).
- Ensure that the scope you specified using `--scope` flag shows up in the output of `vercel switch`. If it doesn't, you're either not a member of the team or you logged into the wrong user account. You can ask an owner of the team to invite you.
