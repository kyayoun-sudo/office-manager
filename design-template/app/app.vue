<script setup lang="ts"></script>

<template>
  <ConfirmDialogProvider>
    <div>
      <NuxtLayout>
        <NuxtRouteAnnouncer />
        <NuxtLoadingIndicator />
        <NuxtPage />
      </NuxtLayout>
      <UiToaster class="pointer-events-auto" />
    </div>
  </ConfirmDialogProvider>
</template>
