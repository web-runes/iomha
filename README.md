# iomha

I've done a fair bit of research and here are some notes:

- https://github.com/JonasKruckenberg/imagetools/ is great because it's simple, but allows for less things
- More complex APIs like Astro and Nuxt rely on having the APIs being run during prerendering, and doings things in a 2nd phase. As a result, it makes it complicated to abstract away (eg. as just as a Vite plugin). It needs looking into how every framework does prerendering
- Remote images are properly a completely distinct API, like unpic
