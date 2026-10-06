import { mount } from 'svelte';
import App from './App.svelte';
import './styles/fonts.css';
import './styles/app.css';

const target = document.querySelector<HTMLDivElement>('#app');
if (!target) throw new Error('#app not found');

mount(App, { target });
