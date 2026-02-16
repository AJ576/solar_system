import * as THREE from "three";
import { FlyControls } from "three/addons/controls/FlyControls.js";

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
    35,
    window.innerWidth / window.innerHeight,
    0.1,
    200
);

camera.position.z = 100;
camera.position.y = 5;

const sphereGeometry = new THREE.SphereGeometry(1,32,32);
const sunMaterial = new THREE.MeshBasicMaterial({color:'yellow'});
const sun = new THREE.Mesh(sphereGeometry, sunMaterial);
sun.scale.setScalar(5);
scene.add(sun);

//Vibecoded this thing cuz I didnt wana do ts
// Planet data (scaled realistically relative to Earth)
// Real radius ratios: Mercury 0.38, Venus 0.95, Earth 1.0, Mars 0.53, Jupiter 11.2
// Real distance ratios (AU): Mercury 0.39, Venus 0.72, Earth 1.0, Mars 1.52, Jupiter 5.2
const planetsData = [
    {
        name: 'Mercury',
        radius: 0.38,
        distance: 12,
        speed: 0.04,
        rotation: 0.004,
        color: 0x8c7853,
        moons: []
    },
    {
        name: 'Venus',
        radius: 0.95,
        distance: 20,
        speed: 0.015,
        rotation: 0.002,
        color: 0xffc649,
        moons: []
    },
    {
        name: 'Earth',
        radius: 1,
        distance: 28,
        speed: 0.01,
        rotation: 0.02,
        color: 0x2233ff,
        moons: [
            { name: 'Moon', radius: 0.35, distance: 2.5, speed: 0.1, color: 0x888888 }
        ]
    },
    {
        name: 'Mars',
        radius: 0.53,
        distance: 38,
        speed: 0.008,
        rotation: 0.018,
        color: 0xdc4c3c,
        moons: [
            // Phobos and Deimos are tiny (11km and 6km vs Mars 3,390km)
            { name: 'Phobos', radius: 0.05, distance: 1.5, speed: 0.2, color: 0x888888 },
            { name: 'Deimos', radius: 0.04, distance: 2.3, speed: 0.15, color: 0x888888 }
        ]
    },
];

// create planets with moons and let em goon
function createPlanets(planetsData) {
    return planetsData.map((planetData, index) => {
        const planetMaterial = new THREE.MeshStandardMaterial({ color: planetData.color });
        const planet = new THREE.Mesh(sphereGeometry, planetMaterial);
        planet.scale.setScalar(planetData.radius);
        
        
        const startAngle = (index * Math.PI * 0.5); // 0, π/2, π, 3π/2
        planet.position.x = Math.cos(startAngle) * planetData.distance;
        planet.position.z = Math.sin(startAngle) * planetData.distance;
        
        // Store planet data on the mesh
        planet.userData = {
            distance: planetData.distance,
            speed: planetData.speed,
            rotation: planetData.rotation,
            startAngle: startAngle,
            moons: []
        };
        
        // add moons to the planet
        planetData.moons.forEach((moonData, moonIndex) => {
            const moonMaterial = new THREE.MeshStandardMaterial({ color: moonData.color });
            const moon = new THREE.Mesh(sphereGeometry, moonMaterial);
            moon.scale.setScalar(moonData.radius);
            
            // give each moon a different starting angle too cuz why not
            const moonStartAngle = moonIndex * Math.PI * 0.7;
            moon.position.x = Math.cos(moonStartAngle) * moonData.distance;
            moon.position.z = Math.sin(moonStartAngle) * moonData.distance;
            
            // Store moon 
            moon.userData = {
                distance: moonData.distance,
                speed: moonData.speed,
                startAngle: moonStartAngle
            };
            
            planet.add(moon);
            planet.userData.moons.push(moon);
        });
        
        return planet;
    });
}

// create planets and add to scene
const planets = createPlanets(planetsData);
planets.forEach(planet => scene.add(planet));

// add lighting for StandardMaterial
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const pointLight = new THREE.PointLight(0xffffff, 10000);
scene.add(pointLight);

const canvas = document.querySelector("canvas.threejs");

const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const controls = new FlyControls(camera, canvas);
controls.movementSpeed = 20;
controls.rollSpeed = 0.5;

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

const timeScale = 5;

const clock = new THREE.Clock()
const renderLoop = () => {

    const delta = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();
    
    // Animate 
    planets.forEach(planet => {
        // Rotation
        planet.rotation.y += planet.userData.rotation * timeScale;
        
        // Revolution around the sun 
        const angle = planet.userData.startAngle + (elapsedTime * planet.userData.speed * timeScale);
        planet.position.x = Math.cos(angle) * planet.userData.distance;
        planet.position.z = Math.sin(angle) * planet.userData.distance;
        
        // Animate moons
        planet.userData.moons.forEach(moon => {
            moon.rotation.y += 0.01 * timeScale;
            const moonAngle = moon.userData.startAngle + (elapsedTime * moon.userData.speed * timeScale);
            moon.position.x = Math.cos(moonAngle) * moon.userData.distance;
            moon.position.z = Math.sin(moonAngle) * moon.userData.distance;
        });
    });

    controls.update(delta);
    renderer.render(scene, camera);
    window.requestAnimationFrame(renderLoop);
};

renderLoop();
