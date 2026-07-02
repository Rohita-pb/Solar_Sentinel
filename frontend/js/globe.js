/**
 * 3D Globe Visualization for ISRO PS14
 * Uses Three.js to render a rotating Earth with geostationary satellite orbits.
 */

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('globe-container');
    if (!container) return;

    // Set up scene, camera, and renderer
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 1, 1000);
    camera.position.set(0, 20, 140); // Zoomed in significantly to reduce empty space

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // Orbit controls
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enablePan = false;
    controls.minDistance = 70;
    controls.maxDistance = 250;
    controls.autoRotate = false; // Disable auto-rotate to keep India in focus

    // --- Earth Sphere ---
    // Load high-res Earth night map texture
    const textureLoader = new THREE.TextureLoader();
    
    // Using a public domain earth night map URL
    const earthTexture = textureLoader.load('https://unpkg.com/three-globe/example/img/earth-night.jpg');
    
    const earthGeometry = new THREE.SphereGeometry(50, 64, 64);
    
    const earthMaterial = new THREE.MeshStandardMaterial({
        map: earthTexture,
        roughness: 0.6,
        metalness: 0.1,
        transparent: true,
        opacity: 0.95
    });
    
    const earth = new THREE.Mesh(earthGeometry, earthMaterial);
    
    // Tilt the earth slightly for a better angle
    earth.rotation.z = 10 * Math.PI / 180;
    earth.rotation.x = 10 * Math.PI / 180;
    // Rotate to face India (approx 74 deg East)
    earth.rotation.y = -74 * Math.PI / 180;
    
    scene.add(earth);

    // --- Atmosphere Glow ---
    const atmosGeometry = new THREE.SphereGeometry(52, 64, 64);
    const atmosMaterial = new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.1,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending
    });
    const atmosphere = new THREE.Mesh(atmosGeometry, atmosMaterial);
    scene.add(atmosphere);

    // --- Geostationary Orbit Ring (L=6.6 Re approx) ---
    // Earth radius = 50, GEO radius = 50 * 6.6 = 330 (Scaled down slightly for viewability)
    const geoRadius = 150; 
    
    const orbitGeometry = new THREE.BufferGeometry();
    const orbitMaterial = new THREE.LineDashedMaterial({
        color: 0x00e5ff,
        linewidth: 1,
        scale: 1,
        dashSize: 3,
        gapSize: 3,
        transparent: true,
        opacity: 0.4
    });

    const points = [];
    for (let i = 0; i <= 64; i++) {
        const theta = (i / 64) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(theta) * geoRadius, 0, Math.sin(theta) * geoRadius));
    }
    orbitGeometry.setFromPoints(points);
    const orbit = new THREE.Line(orbitGeometry, orbitMaterial);
    orbit.computeLineDistances();
    scene.add(orbit);

    // --- Satellites ---
    const sats = [];
    const numSats = 5;
    for (let i = 0; i < numSats; i++) {
        const satGroup = new THREE.Group();
        
        // Dot
        const satGeometry = new THREE.SphereGeometry(1.5, 8, 8);
        const satMaterial = new THREE.MeshBasicMaterial({ color: 0x00e676 });
        const satMesh = new THREE.Mesh(satGeometry, satMaterial);
        
        // Position
        const angle = (i / numSats) * Math.PI * 2;
        satGroup.position.set(Math.cos(angle) * geoRadius, 0, Math.sin(angle) * geoRadius);
        
        // Link line to earth
        const linkGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0), // Local relative to group, will be offset later
            new THREE.Vector3(-satGroup.position.x, -satGroup.position.y, -satGroup.position.z)
        ]);
        const linkMat = new THREE.LineBasicMaterial({ 
            color: 0x00e5ff, 
            transparent: true, 
            opacity: 0.15 
        });
        const link = new THREE.Line(linkGeom, linkMat);
        
        satGroup.add(satMesh);
        
        // Only add the thin link line for satellites in orbit, 
        // the thick beams will be added separately below
        satGroup.add(link);
        
        scene.add(satGroup);
        sats.push({ group: satGroup, angle: angle });
    }

    // --- Telemetry Beams (Cyan laser beams pointing outwards) ---
    const beamsGroup = new THREE.Group();
    // Create 3 thick cyan beams pointing downwards/outwards from Earth surface
    const beamGeom = new THREE.CylinderGeometry(0.5, 0.5, 200, 8);
    // Shift geometry so the origin is at the top of the cylinder
    beamGeom.translate(0, -100, 0); 
    
    const beamMat = new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending
    });

    // Beam 1
    const beam1 = new THREE.Mesh(beamGeom, beamMat);
    beam1.position.set(0, -45, 20); // Position on lower hemisphere
    beam1.lookAt(new THREE.Vector3(-100, -200, 100)); // Point outwards
    beamsGroup.add(beam1);
    
    // Beam 2
    const beam2 = new THREE.Mesh(beamGeom, beamMat);
    beam2.position.set(-20, -40, 10);
    beam2.lookAt(new THREE.Vector3(-150, -200, 50));
    beamsGroup.add(beam2);
    
    // Beam 3
    const beam3 = new THREE.Mesh(beamGeom, beamMat);
    beam3.position.set(25, -35, 15);
    beam3.lookAt(new THREE.Vector3(100, -180, 150));
    beamsGroup.add(beam3);

    scene.add(beamsGroup);

    // --- Lighting ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
    sunLight.position.set(-100, 50, 100);
    scene.add(sunLight);

    // Add a blue rim light
    const rimLight = new THREE.DirectionalLight(0x00e5ff, 0.8);
    rimLight.position.set(100, -50, -100);
    scene.add(rimLight);

    // --- Solar Wind Particle System ---
    const particlesGeo = new THREE.BufferGeometry();
    const particlesCount = 800;
    const posArray = new Float32Array(particlesCount * 3);
    
    // Distribute particles to the left (coming from sun)
    for(let i=0; i < particlesCount * 3; i+=3) {
        // x from -300 to -100
        posArray[i] = (Math.random() * -200) - 100;
        // y from -100 to 100
        posArray[i+1] = (Math.random() - 0.5) * 200;
        // z from -100 to 100
        posArray[i+2] = (Math.random() - 0.5) * 200;
    }
    particlesGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    
    // Soft glowing cyan material
    const particleMat = new THREE.PointsMaterial({
        size: 0.8,
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending
    });
    
    const particleSystem = new THREE.Points(particlesGeo, particleMat);
    scene.add(particleSystem);

    // --- Animation Loop ---
    const clock = new THREE.Clock();

    function animate() {
        requestAnimationFrame(animate);
        
        const delta = clock.getDelta();
        
        // Slowly rotate earth independent of camera
        earth.rotation.y += 0.05 * delta;
        
        // Move satellites along orbit
        sats.forEach(sat => {
            sat.angle += 0.05 * delta;
            sat.group.position.set(
                Math.cos(sat.angle) * geoRadius,
                0,
                Math.sin(sat.angle) * geoRadius
            );
            // Update link line vertices
            const positions = sat.group.children[1].geometry.attributes.position.array;
            positions[3] = -sat.group.position.x;
            positions[4] = -sat.group.position.y;
            positions[5] = -sat.group.position.z;
            sat.group.children[1].geometry.attributes.position.needsUpdate = true;
        });

        // Animate Solar Wind particles
        const positions = particleSystem.geometry.attributes.position.array;
        for (let i = 0; i < particlesCount * 3; i += 3) {
            // Move particles to the right (+x direction)
            positions[i] += 80 * delta; 
            
            // If they pass the earth (x > 50), reset them back to the left
            if (positions[i] > 50) {
                positions[i] = -200 - Math.random() * 100;
            }
        }
        particleSystem.geometry.attributes.position.needsUpdate = true;

        controls.update();
        renderer.render(scene, camera);
    }
    
    animate();

    // Handle window resize
    window.addEventListener('resize', () => {
        if (!container) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    });
});
