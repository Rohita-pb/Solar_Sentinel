/**
 * 3D Scene and GSAP Animation for Landing Page
 */

let scene, camera, renderer, controls;
let satellite, earth;
let isLaunching = false;
const container = document.getElementById('canvas-container');

// HUD Crosshair magnetic tracking
let rawMouseX = window.innerWidth / 2;
let rawMouseY = window.innerHeight / 2;
let crosshairX = window.innerWidth / 2;
let crosshairY = window.innerHeight / 2;
let solarWindParticles;

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

    // 8b. Create Solar Wind Particle Stream
    createSolarWind();

    // 9. Event Listeners
    window.addEventListener('resize', onWindowResize);
    document.addEventListener('mousemove', onMouseMove);
    document.getElementById('launch-btn').addEventListener('click', onLaunchClick);

    // 10. Smooth Scrolling for Navigation Links & Tiles
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                const targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset;
                const startPosition = window.pageYOffset;
                
                const scrollObj = { value: startPosition };
                gsap.to(scrollObj, {
                    value: targetPosition,
                    duration: 1.2,
                    ease: "power3.inOut",
                    onUpdate: () => {
                        window.scrollTo(0, scrollObj.value);
                    }
                });
            }
        });
    });
}

function onMouseMove(event) {
    // Keep raw coordinates for the magnetic HUD crosshair follower
    rawMouseX = event.clientX;
    rawMouseY = event.clientY;

    // Keep relative coordinates for 3D camera parallax
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
    
    // Detailed materials
    const metalMat = new THREE.MeshStandardMaterial({ 
        color: 0xdddddd, metalness: 0.9, roughness: 0.15 
    });
    const darkMetalMat = new THREE.MeshStandardMaterial({ 
        color: 0x444444, metalness: 0.8, roughness: 0.4 
    });
    const copperMat = new THREE.MeshStandardMaterial({ 
        color: 0xd47a55, metalness: 0.9, roughness: 0.2 
    });
    const goldFoilMat = new THREE.MeshStandardMaterial({ 
        color: 0xffb700, metalness: 0.7, roughness: 0.35, bumpScale: 0.05
    });
    const solarCellMat = new THREE.MeshStandardMaterial({ 
        color: 0x0a1c3a, metalness: 0.9, roughness: 0.05, emissive: 0x001122
    });
    const glassLensMat = new THREE.MeshStandardMaterial({
        color: 0x111111, roughness: 0.1, metalness: 0.9
    });

    // 1. Main Body (Hexagonal Cylinder)
    const bodyGeom = new THREE.CylinderGeometry(1.4, 1.4, 3.8, 6);
    const body = new THREE.Mesh(bodyGeom, goldFoilMat);
    body.rotation.z = Math.PI / 2;
    satellite.add(body);

    // End caps for the hexagonal body
    const capGeom = new THREE.CylinderGeometry(1.45, 1.45, 0.2, 6);
    const leftCap = new THREE.Mesh(capGeom, metalMat);
    leftCap.position.set(-1.9, 0, 0);
    leftCap.rotation.z = Math.PI / 2;
    satellite.add(leftCap);

    const rightCap = new THREE.Mesh(capGeom, metalMat);
    rightCap.position.set(1.9, 0, 0);
    rightCap.rotation.z = Math.PI / 2;
    satellite.add(rightCap);

    // 2. Solar Panels Assembly (Detailed with cells and frames)
    // Connecting rods
    const rodGeom = new THREE.CylinderGeometry(0.12, 0.12, 2.5);
    
    const leftRod = new THREE.Mesh(rodGeom, darkMetalMat);
    leftRod.position.set(-2.5, 0, 0);
    leftRod.rotation.z = Math.PI / 2;
    satellite.add(leftRod);

    const rightRod = new THREE.Mesh(rodGeom, darkMetalMat);
    rightRod.position.set(2.5, 0, 0);
    rightRod.rotation.z = Math.PI / 2;
    satellite.add(rightRod);

    // Solar Wings Groups
    const createSolarWing = (isLeft) => {
        const wingGroup = new THREE.Group();
        
        // Main panel frame (grey metal)
        const frameGeom = new THREE.BoxGeometry(6.2, 0.08, 2.2);
        const frame = new THREE.Mesh(frameGeom, darkMetalMat);
        wingGroup.add(frame);

        // Add 3 separate solar cell panels on top of the frame for realistic segmentation
        const cellGeom = new THREE.BoxGeometry(1.8, 0.04, 1.95);
        const cellOffset = [-2, 0, 2];
        cellOffset.forEach(xOffset => {
            const cell = new THREE.Mesh(cellGeom, solarCellMat);
            cell.position.set(xOffset, 0.05, 0);
            wingGroup.add(cell);

            // Add metallic grid details on top of each cell
            const gridGeom = new THREE.BoxGeometry(0.02, 0.06, 1.95);
            const grid1 = new THREE.Mesh(gridGeom, metalMat);
            grid1.position.set(xOffset - 0.4, 0.05, 0);
            wingGroup.add(grid1);

            const grid2 = new THREE.Mesh(gridGeom, metalMat);
            grid2.position.set(xOffset + 0.4, 0.05, 0);
            wingGroup.add(grid2);
        });

        // Position the wing group
        wingGroup.position.set(isLeft ? -6.5 : 6.5, 0, 0);
        return wingGroup;
    };

    satellite.add(createSolarWing(true));
    satellite.add(createSolarWing(false));

    // 3. High-Gain Antenna Dish
    const dishGeom = new THREE.SphereGeometry(1.1, 24, 24, 0, Math.PI);
    const dish = new THREE.Mesh(dishGeom, metalMat);
    dish.scale.set(1, 0.4, 1);
    dish.position.set(0, 1.4, 0);
    dish.rotation.x = -Math.PI / 2;
    satellite.add(dish);

    // Antenna feed horn assembly
    const hornRodGeom = new THREE.CylinderGeometry(0.04, 0.04, 1.0);
    const hornRod = new THREE.Mesh(hornRodGeom, darkMetalMat);
    hornRod.position.set(0, 2.0, 0);
    satellite.add(hornRod);

    const hornTipGeom = new THREE.SphereGeometry(0.15, 8, 8);
    const hornTip = new THREE.Mesh(hornTipGeom, copperMat);
    hornTip.position.set(0, 2.5, 0);
    satellite.add(hornTip);

    // 4. Science Instrumentation (Pay Load Boxes / Thrusters / Probes)
    // Main instrument box (Earth facing)
    const instBoxGeom = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const instBox = new THREE.Mesh(instBoxGeom, metalMat);
    instBox.position.set(0, -1.5, 0);
    satellite.add(instBox);

    // Instrument Lens / Sensor aperture
    const lensGeom = new THREE.CylinderGeometry(0.25, 0.25, 0.3, 16);
    const lens = new THREE.Mesh(lensGeom, glassLensMat);
    lens.position.set(0, -1.9, 0);
    satellite.add(lens);

    // Gold sensor tube
    const tubeGeom = new THREE.CylinderGeometry(0.15, 0.15, 0.8, 12);
    const tube = new THREE.Mesh(tubeGeom, goldFoilMat);
    tube.position.set(0.8, -1.5, 0.3);
    tube.rotation.x = Math.PI / 4;
    satellite.add(tube);

    // Magnetometer Boom (Long thin rod)
    const boomGeom = new THREE.CylinderGeometry(0.05, 0.05, 4.5);
    const boom = new THREE.Mesh(boomGeom, darkMetalMat);
    boom.position.set(0, 0, -2.5);
    boom.rotation.x = Math.PI / 2;
    satellite.add(boom);

    // Sensor at the end of the boom
    const boomSensorGeom = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const boomSensor = new THREE.Mesh(boomSensorGeom, copperMat);
    boomSensor.position.set(0, 0, -4.8);
    satellite.add(boomSensor);

    // 5. Thruster clusters (RCS nozzles)
    const createThruster = (x, y, z, rx, rz) => {
        const thrusterGroup = new THREE.Group();
        const blockGeom = new THREE.BoxGeometry(0.3, 0.3, 0.3);
        const block = new THREE.Mesh(blockGeom, darkMetalMat);
        thrusterGroup.add(block);

        const nozzleGeom = new THREE.ConeGeometry(0.08, 0.22, 8);
        const nozzle = new THREE.Mesh(nozzleGeom, copperMat);
        nozzle.position.set(0, -0.2, 0);
        thrusterGroup.add(nozzle);

        thrusterGroup.position.set(x, y, z);
        thrusterGroup.rotation.set(rx, 0, rz);
        return thrusterGroup;
    };

    // Add 4 thruster clusters around the end caps for realistic attitude control
    satellite.add(createThruster(-1.8, 0.8, 0.8, 0, -Math.PI / 4));
    satellite.add(createThruster(-1.8, -0.8, -0.8, Math.PI, -Math.PI / 4));
    satellite.add(createThruster(1.8, 0.8, -0.8, 0, Math.PI / 4));
    satellite.add(createThruster(1.8, -0.8, 0.8, Math.PI, Math.PI / 4));

    // Wrap in a subtle floating animation group
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
    
    // Animate crosshair magnetic lag
    const crosshair = document.getElementById('hud-crosshair');
    if (crosshair) {
        crosshairX += (rawMouseX - crosshairX) * 0.15;
        crosshairY += (rawMouseY - crosshairY) * 0.15;
        crosshair.style.left = `${crosshairX}px`;
        crosshair.style.top = `${crosshairY}px`;
    }

    // Animate Solar Wind Particle Stream
    animateSolarWind();
    
    if (!isLaunching) {
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
    }
    
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
    isLaunching = true;

    // Stop existing GSAP float and rotation tweens on satellite
    gsap.killTweensOf(satellite.position);
    gsap.killTweensOf(satellite.rotation);

    // 3. Animate Satellite revolving around Earth, and Camera following it
    const animState = { pct: 0 };
    
    // Calculate initial relative values
    const relX = config.satellitePos.x - config.earthPos.x;
    const relY = config.satellitePos.y - config.earthPos.y;
    const relZ = config.satellitePos.z - config.earthPos.z;
    const initialRadius = Math.sqrt(relX * relX + relY * relY + relZ * relZ);
    const targetRadius = 34.0; // Just above Earth's surface (radius 30)

    const startAngle = Math.atan2(relZ, relX);
    const startY = config.satellitePos.y;
    const endY = config.earthPos.y;

    gsap.to(animState, {
        pct: 1,
        duration: 3.5,
        ease: "power2.inOut",
        onUpdate: () => {
            const t = animState.pct;
            
            // Revolve: 1.5 full revolutions around the Earth
            const angle = startAngle + t * Math.PI * 3.0; 
            
            // Spiral inward: start at initialRadius, end near the Earth
            const r = initialRadius * (1 - t) + targetRadius * t;
            
            // Update satellite position
            const x = config.earthPos.x + Math.cos(angle) * r;
            const z = config.earthPos.z + Math.sin(angle) * r;
            const y = startY * (1 - t) + endY * t;
            
            satellite.position.set(x, y, z);
            
            // Orient the satellite to look towards the center of Earth
            satellite.lookAt(config.earthPos.x, config.earthPos.y, config.earthPos.z);
            satellite.rotation.z += 0.05; // Spin on its axis for realistic touch
 
            // Camera follow: trails slightly behind the satellite along the orbit
            const trailAngle = angle - 0.4 * (1 - t);
            const camR = r + 15 * (1 - t) + 4 * t;
            const camX = config.earthPos.x + Math.cos(trailAngle) * camR;
            const camZ = config.earthPos.z + Math.sin(trailAngle) * camR;
            const camY = y + 8 * (1 - t) + 2 * t;

            camera.position.set(camX, camY, camZ);
            
            // Near the end of the transition, the camera dives into the Earth
            if (t > 0.85) {
                const blend = (t - 0.85) / 0.15; // 0 to 1
                camera.lookAt(
                    config.earthPos.x * blend + satellite.position.x * (1 - blend),
                    config.earthPos.y * blend + satellite.position.y * (1 - blend),
                    config.earthPos.z * blend + satellite.position.z * (1 - blend)
                );
            } else {
                camera.lookAt(satellite.position);
            }
        }
    });

    // 4. White flash transition overlay
    gsap.to('#transition-overlay', {
        opacity: 1,
        duration: 0.5,
        delay: 3.1, // Trigger right as we dive into Earth
        ease: "power2.in",
        onComplete: () => {
            // 5. Redirect to Dashboard
            window.location.href = "index.html";
        }
    });
}

// ============================================================
// Solar Wind Particle System
// ============================================================

function createSolarWind() {
    const particleCount = 200;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const speeds = new Float32Array(particleCount);
    
    for (let i = 0; i < particleCount; i++) {
        // Wide flow streaming from left (x = -80) to right (x = 80)
        positions[i * 3] = (Math.random() - 0.5) * 160; 
        positions[i * 3 + 1] = (Math.random() - 0.5) * 60; 
        positions[i * 3 + 2] = (Math.random() - 0.5) * 40; 
        
        speeds[i] = 0.2 + Math.random() * 0.4;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    // Procedural cyan glowing canvas texture
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    grad.addColorStop(0, 'rgba(0, 229, 255, 1)'); 
    grad.addColorStop(0.3, 'rgba(0, 150, 255, 0.6)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 16);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.PointsMaterial({
        size: 0.8,
        map: texture,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    
    solarWindParticles = new THREE.Points(geometry, material);
    scene.add(solarWindParticles);
    
    solarWindParticles.userData = { speeds: speeds };
}

function animateSolarWind() {
    if (!solarWindParticles) return;
    
    const positions = solarWindParticles.geometry.attributes.position.array;
    const speeds = solarWindParticles.userData.speeds;
    
    for (let i = 0; i < speeds.length; i++) {
        // Move particles along X axis from left to right
        positions[i * 3] += speeds[i];
        
        // Recycle particles
        if (positions[i * 3] > 80) {
            positions[i * 3] = -80;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 60;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 40;
        }
    }
    
    solarWindParticles.geometry.attributes.position.needsUpdate = true;
}
