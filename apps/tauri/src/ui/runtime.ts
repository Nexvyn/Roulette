// What each server runs, shown as its logo in place of a status dot. The logos come from
// runeicons-brands (each keeps its own licence; see the package's NOTICE.md).
import angular from "runeicons-brands/svg/angular.svg";
import astro from "runeicons-brands/svg/astro.svg";
import bun from "runeicons-brands/svg/bun.svg";
import deno from "runeicons-brands/svg/deno.svg";
import django from "runeicons-brands/svg/django.svg";
import docker from "runeicons-brands/svg/docker.svg";
import dotnet from "runeicons-brands/svg/dotnet.svg";
import elixir from "runeicons-brands/svg/elixir.svg";
import expo from "runeicons-brands/svg/expo.svg";
import go from "runeicons-brands/svg/go.svg";
import java from "runeicons-brands/svg/java.svg";
import next from "runeicons-brands/svg/nextdotjs.svg";
import node from "runeicons-brands/svg/nodejs.svg";
import nuxt from "runeicons-brands/svg/nuxt.svg";
import php from "runeicons-brands/svg/php.svg";
import python from "runeicons-brands/svg/python.svg";
import remix from "runeicons-brands/svg/remix.svg";
import ruby from "runeicons-brands/svg/ruby.svg";
import rust from "runeicons-brands/svg/rust.svg";
import storybook from "runeicons-brands/svg/storybook.svg";
import svelte from "runeicons-brands/svg/svelte.svg";
import vite from "runeicons-brands/svg/vite.svg";

export interface Runtime {
  name: string;
  logo: string;
  dark?: "invert" | "white";
}

const RULES: [RegExp, Runtime][] = [
  [/next/, { name: "Next.js", logo: next, dark: "invert" }],
  [/vite|vitest/, { name: "Vite", logo: vite }],
  [/nuxt/, { name: "Nuxt", logo: nuxt }],
  [/astro/, { name: "Astro", logo: astro }],
  [/remix/, { name: "Remix", logo: remix, dark: "white" }],
  [/svelte/, { name: "Svelte", logo: svelte }],
  [/storybook/, { name: "Storybook", logo: storybook }],
  [/\bng\b|angular/, { name: "Angular", logo: angular }],
  [/expo|metro/, { name: "Expo", logo: expo, dark: "white" }],
  [/\bbun\b/, { name: "Bun", logo: bun }],
  [/deno/, { name: "Deno", logo: deno, dark: "white" }],
  [/django|manage\.py/, { name: "Django", logo: django, dark: "white" }],
  [/python|uvicorn|gunicorn|flask|fastapi/, { name: "Python", logo: python }],
  [/ruby|rails|puma/, { name: "Ruby", logo: ruby }],
  [/\bgo\b|\bair\b/, { name: "Go", logo: go }],
  [/cargo|rust/, { name: "Rust", logo: rust, dark: "white" }],
  [/php|artisan/, { name: "PHP", logo: php }],
  [/java|gradle|mvn/, { name: "Java", logo: java }],
  [/dotnet/, { name: ".NET", logo: dotnet }],
  [/beam|elixir|mix\b/, { name: "Elixir", logo: elixir }],
  [/docker|com\.docker/, { name: "Docker", logo: docker }],
];

const NODE: Runtime = { name: "Node.js", logo: node };

export function runtimeFor(processName: string): Runtime {
  const p = processName.toLowerCase();
  return RULES.find(([re]) => re.test(p))?.[1] ?? NODE;
}
