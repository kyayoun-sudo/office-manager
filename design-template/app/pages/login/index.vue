<script setup lang="ts">
definePageMeta({
  layout: 'auth',
  middleware: 'guest',
})

useHead({ title: 'Connexion - Modèle d’administration' })
</script>

<template>
  <LoginForm />
</template>
