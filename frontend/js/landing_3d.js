/**
 * 3D Scene and GSAP Animation for Landing Page
 */

let scene, camera, renderer, controls;
let satellite, earth;
const container = document.getElementById('canvas-container');

// Configuration
const config = {
    cameraStart: { x: 20, y: 10, z: 40 },
    satellitePos: { x: 10, y: 0, z: 20 },
    earthPos: { x: -40, y: -20, z: -50 }
};

// Parallax state
let mouseX = 0;
let mouseY = 0;
let targetX = 0;
let targetY = 0;
let windowHalfX = window.innerWidth / 2;
let windowHalfY = window.innerHeight / 2;
let starGroup;

init();
animate();

function init() {
    // 1. Scene Setup
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050810, 0.005); // Match CSS background

    // 2. Camera Setup
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(config.cameraStart.x, config.cameraStart.y, config.cameraStart.z);

    // 3. Renderer Setup
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // 4. Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enablePan = false;
    controls.minDistance = 10;
    controls.maxDistance = 100;
    // Target the satellite initially
    controls.target.set(config.satellitePos.x, config.satellitePos.y, config.satellitePos.z);

    // 5. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 1.5);
    mainLight.position.set(50, 50, 50);
    scene.add(mainLight);

    const rimLight = new THREE.DirectionalLight(0x00e5ff, 2.0); // Cyan rim light
    rimLight.position.set(-50, -50, -50);
    scene.add(rimLight);

    // 6. Create Procedural Satellite
    createSatellite();

    // 7. Create Earth (Background)
    createEarth();

    // 8. Create Starfield & Nebulas
    createStarfield();

    // 9. Event Listeners
    window.addEventListener('resize', onWindowResize);
    document.addEventListener('mousemove', onMouseMove);
    document.getElementById('launch-btn').addEventListener('click', onLaunchClick);
}

function onMouseMove(event) {
    mouseX = (event.clientX - windowHalfX);
    mouseY = (event.clientY - windowHalfY);
}

function createStarfield() {
    starGroup = new THREE.Group();
    
    // 1. Basic Stars
    const starsGeo = new THREE.BufferGeometry();
    const starsCount = 3000;
    const posArray = new Float32Array(starsCount * 3);
    for(let i=0; i < starsCount * 3; i++) {
        // Range -500 to 500
        posArray[i] = (Math.random() - 0.5) * 1000;
    }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    
    const starsMat = new THREE.PointsMaterial({
        size: 0.5,
        color: 0xffffff,
        transparent: true,
        opacity: 0.8
    });
    const starPoints = new THREE.Points(starsGeo, starsMat);
    starGroup.add(starPoints);

    // 2. Nebula Glows (Large fuzzy particles)
    const nebulaGeo = new THREE.BufferGeometry();
    const nebulaCount = 50;
    const nebArray = new Float32Array(nebulaCount * 3);
    for(let i=0; i < nebulaCount * 3; i++) {
        nebArray[i] = (Math.random() - 0.5) * 800;
    }
    nebulaGeo.setAttribute('position', new THREE.BufferAttribute(nebArray, 3));
    
    // Create soft radial gradient texture procedurally
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.2, 'rgba(0,100,255,0.8)');
    gradient.addColorStop(0.5, 'rgba(0,20,100,0.2)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const nebulaTexture = new THREE.CanvasTexture(canvas);
    
    const nebulaMat = new THREE.PointsMaterial({
        size: 150,
        map: nebulaTexture,
        color: 0x00aaff, // Cyan-blue tint
        transparent: true,
        opacity: 0.15, // Slightly more visible now that it's soft
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const nebulaPoints = new THREE.Points(nebulaGeo, nebulaMat);
    starGroup.add(nebulaPoints);
    
    // Add to scene but push it far back
    starGroup.position.z = -200;
    scene.add(starGroup);
}

function createSatellite() {
    satellite = new THREE.Group();
    satellite.position.set(config.satellitePos.x, config.satellitePos.y, config.satellitePos.z);
    
    // Materials
    const metalMat = new THREE.MeshStandardMaterial({ 
        color: 0xcccccc, metalness: 0.8, roughness: 0.2 
    });
    const goldFoilMat = new THREE.MeshStandardMaterial({ 
        color: 0xffaa00, metalness: 0.6, roughness: 0.4, bumpScale: 0.02
    });
    const panelMat = new THREE.MeshStandardMaterial({ 
        color: 0x051020, metalness: 0.9, roughness: 0.1, emissive: 0x002244
    });

    // Main Body (Hexagonal Cylinder)
    const bodyGeom = new THREE.CylinderGeometry(1.5, 1.5, 4, 6);
    const body = new THREE.Mesh(bodyGeom, goldFoilMat);
    body.rotation.z = Math.PI / 2;
    satellite.add(body);

    // Solar Panels
    const panelGeom = new THREE.BoxGeometry(8, 0.1, 2);
    
    // Left Wing
    const leftWing = new THREE.Mesh(panelGeom, panelMat);
    leftWing.position.set(-6, 0, 0);
    satellite.add(leftWing);
    
    // Right Wing
    const rightWing = new THREE.Mesh(panelGeom, panelMat);
    rightWing.position.set(6, 0, 0);
    satellite.add(rightWing);

    // Antenna Dish
    const dishGeom = new THREE.SphereGeometry(1, 16, 16, 0, Math.PI);
    const dish = new THREE.Mesh(dishGeom, metalMat);
    dish.scale.set(1, 0.3, 1);
    dish.position.set(0, 1.2, 0);
    dish.rotation.x = -Math.PI / 2;
    satellite.add(dish);

    // Sensor / Probe
    const probeGeom = new THREE.CylinderGeometry(0.1, 0.1, 3);
    const probe = new THREE.Mesh(probeGeom, metalMat);
    probe.position.set(2, -1, 0);
    satellite.add(probe);

    // Subtle floating animation wrapper
    const floatWrapper = new THREE.Group();
    floatWrapper.add(satellite);
    scene.add(floatWrapper);
    
    // Animate satellite rotation slowly
    gsap.to(satellite.rotation, {
        y: Math.PI * 2,
        duration: 40,
        repeat: -1,
        ease: "none"
    });
    
    // Bobbing up and down
    gsap.to(satellite.position, {
        y: "+=0.5",
        duration: 2,
        yoyo: true,
        repeat: -1,
        ease: "sine.inOut"
    });
}

function createEarth() {
    earth = new THREE.Group();
    earth.position.set(config.earthPos.x, config.earthPos.y, config.earthPos.z);

    const radius = 30;
    
    // Load high-res Earth night map texture
    const textureLoader = new THREE.TextureLoader();
    const earthTexture = textureLoader.load('https://unpkg.com/three-globe/example/img/earth-night.jpg');

    // Core
    const earthMat = new THREE.MeshStandardMaterial({
        map: earthTexture,
        roughness: 0.6,
        metalness: 0.1
    });
    const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 64), earthMat);
    
    // Tilt the earth slightly
    earthMesh.rotation.z = 10 * Math.PI / 180;
    earthMesh.rotation.x = 10 * Math.PI / 180;
    // Rotate so India is roughly facing the camera side (depending on landing camera pos)
    earthMesh.rotation.y = -45 * Math.PI / 180; 

    earth.add(earthMesh);

    // Atmosphere Glow
    const atmosMat = new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.1,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending
    });
    const atmosMesh = new THREE.Mesh(new THREE.SphereGeometry(radius + 2, 64, 64), atmosMat);
    earth.add(atmosMesh);

    scene.add(earth);

    // Rotate Earth slowly
    gsap.to(earth.rotation, {
        y: Math.PI * 2,
        duration: 120,
        repeat: -1,
        ease: "none"
    });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    
    // Parallax Effect
    targetX = mouseX * 0.001;
    targetY = mouseY * 0.001;
    
    if (starGroup) {
        starGroup.rotation.y += 0.05 * (targetX - starGroup.rotation.y);
        starGroup.rotation.x += 0.05 * (targetY - starGroup.rotation.x);
    }
    
    // Slight camera movement based on mouse
    camera.position.x += (mouseX * 0.01 - camera.position.x + config.cameraStart.x) * 0.05;
    camera.position.y += (-mouseY * 0.01 - camera.position.y + config.cameraStart.y) * 0.05;
    camera.lookAt(config.satellitePos.x, config.satellitePos.y, config.satellitePos.z);
    
    controls.update();
    renderer.render(scene, camera);
}

// ============================================================
// Launch Animation (GSAP)
// ============================================================

function onLaunchClick() {
    const btn = document.getElementById('launch-btn');
    btn.style.pointerEvents = 'none';
    
    // 1. Fade out UI Layer
    gsap.to('#ui-layer', {
        opacity: 0,
        duration: 0.5,
        ease: "power2.inOut"
    });

    // 2. Disable orbit controls
    controls.enabled = false;

    // 3. Animate Camera to zoom past the satellite, toward the Earth
    // We calculate a position very close to the Earth's surface
    const targetZ = config.earthPos.z + 32; // Just above the 30 radius sphere
    
    gsap.to(camera.position, {
        x: config.earthPos.x,
        y: config.earthPos.y,
        z: targetZ,
        duration: 2.0,
        ease: "power3.in",
        onUpdate: () => {
            // Keep looking at Earth as we fly towards it
            camera.lookAt(config.earthPos.x, config.earthPos.y, config.earthPos.z);
        }
    });

    // 4. White flash transition overlay
    gsap.to('#transition-overlay', {
        opacity: 1,
        duration: 0.4,
        delay: 1.8, // Trigger right before camera hits Earth
        ease: "power2.in",
        onComplete: () => {
            // 5. Redirect to Dashboard
            window.location.href = "index.html";
        }
    });
}
