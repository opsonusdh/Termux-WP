# Contributing to the Termux WhatsApp API Gateway

First off, thank you for taking the time to contribute! It’s awesome that you want to help make this project better for developers trying to run automation setups directly on Android hardware.

This project is entirely open-source, and we welcome anyone who wants to fix bugs, optimize performance, or add cool new features.

---

## How Can I Contribute?

### 1. Reporting Bugs
Found something broken or crashing on your specific Android version? Let us know!
* Open an **Issue** in the repository.
* Tell us your **Android Version**, **Termux Version**, and the exact error log crashing your screen.
* Share a snippet of the code configuration that caused the crash so we can reproduce it.

### 2. Suggesting Enhancements
Want the gateway to handle audio files, image attachments, or automatic connection resets? 
* Open an **Issue** explaining your idea.
* Tell us *why* this feature would be helpful and *how* you think it should work visually or via the API endpoint design.

### 3. Submitting Pull Requests (Code Changes)
Ready to write some code? Here is how to get your changes merged smoothly:
1. **Fork** the repository to your own GitHub account.
2. Create a new branch for your feature or bug fix (`git checkout -b feature/cool-new-endpoint`).
3. Write your code! Keep it simple, clear, and clean.
4. **Test your code directly inside Termux** before submitting. If your feature relies on a package that requires complex C++ compilation (like native database engines), it will break the project goals. Make sure everything remains lightweight and node-native.
5. Push your branch and open a **Pull Request** against our `main` branch.
6. Clearly describe what your code fixes or adds in the description box.

---

## Coding Ground Rules

* **Bypassing Build Roadblocks:** Always check that any new `npm` packages you introduce don't break compatibility with ARM processors or require an Android NDK toolchain configuration to compile.
* **Keep it Stateless:** We want to keep the gateway free of heavy data writes to preserve mobile flash memory storage. Stick to loading contexts dynamically from the browser instances when possible.
* **Don't Commit Sessions:** Make sure you never push your `.wwebjs_auth` folder, private phone numbers, or session tokens up to your GitHub repository fork!
