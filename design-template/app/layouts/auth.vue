<template>
  <div class="min-h-svh lg:grid lg:grid-cols-2">
    <div
      class="relative hidden flex-col bg-background p-10 text-primary dark:border-r lg:flex"
    >
      <div class="flex flex-1 flex-col items-center justify-center">
        <div class="mb-8 flex flex-col items-center">
          <img
            src="/placeholder.svg"
            alt="Exemple"
            class="mb-4 size-20 object-contain"
          >
          <h1 class="text-2xl font-bold text-primary">Exemple</h1>
        </div>
        <blockquote class="max-w-md space-y-4 text-center">
          <p class="text-lg text-primary">
            &ldquo;Plateforme de gestion des soins de sante moderne et intuitive.
            Modèle d’administration simplifie la gestion des utilisateurs et optimise
            les processus administratifs.&rdquo;
          </p>
          <footer class="text-sm text-primary/80">L’équipe</footer>
        </blockquote>
      </div>
    </div>
    <div class="flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-8 sm:px-6 lg:min-h-0 lg:px-8">
      <div class="flex items-center gap-2 lg:hidden">
        <img
          src="/placeholder.svg"
          alt="Exemple"
          class="size-8 object-contain"
        >
        <span class="text-lg font-bold text-primary">Exemple</span>
      </div>
      <div class="w-full max-w-sm">
        <slot />
      </div>
    </div>
  </div>
</template>
